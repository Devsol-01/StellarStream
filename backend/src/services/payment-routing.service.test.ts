import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentRoutingService, conditionMatches } from './payment-routing.service.js';
import { prisma } from '../lib/db.js';

vi.mock('../lib/db.js', () => ({
  prisma: {
    paymentRoutingRule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const OWNER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

describe('conditionMatches', () => {
  it('matches amount gte', () => {
    const condition = { type: 'amount', operator: 'gte', value: '1000', value2: null };
    expect(conditionMatches(condition, { amount: '1500', tokenAddress: 'USDC' })).toBe(true);
    expect(conditionMatches(condition, { amount: '500', tokenAddress: 'USDC' })).toBe(false);
  });

  it('matches amount between', () => {
    const condition = { type: 'amount', operator: 'between', value: '100', value2: '200' };
    expect(conditionMatches(condition, { amount: '150', tokenAddress: 'USDC' })).toBe(true);
    expect(conditionMatches(condition, { amount: '300', tokenAddress: 'USDC' })).toBe(false);
  });

  it('matches asset equals and in', () => {
    const equals = { type: 'asset', operator: 'equals', value: 'USDC', value2: null };
    expect(conditionMatches(equals, { amount: '1', tokenAddress: 'USDC' })).toBe(true);
    expect(conditionMatches(equals, { amount: '1', tokenAddress: 'XLM' })).toBe(false);

    const inList = { type: 'asset', operator: 'in', value: 'USDC, XLM', value2: null };
    expect(conditionMatches(inList, { amount: '1', tokenAddress: 'XLM' })).toBe(true);
    expect(conditionMatches(inList, { amount: '1', tokenAddress: 'BTC' })).toBe(false);
  });

  it('matches geography equals and in', () => {
    const equals = { type: 'geography', operator: 'equals', value: 'US', value2: null };
    expect(conditionMatches(equals, { amount: '1', tokenAddress: 'USDC', region: 'US' })).toBe(true);
    expect(conditionMatches(equals, { amount: '1', tokenAddress: 'USDC', region: 'EU' })).toBe(false);
    expect(conditionMatches(equals, { amount: '1', tokenAddress: 'USDC' })).toBe(false);

    const inList = { type: 'geography', operator: 'in', value: 'US,EU', value2: null };
    expect(conditionMatches(inList, { amount: '1', tokenAddress: 'USDC', region: 'EU' })).toBe(true);
  });

  it('matches time window within the same day', () => {
    const condition = { type: 'time', operator: 'between', value: '09:00', value2: '17:00' };
    const inWindow = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const outsideWindow = new Date(Date.UTC(2026, 0, 1, 20, 0));
    expect(conditionMatches(condition, { amount: '1', tokenAddress: 'USDC', timestamp: inWindow })).toBe(true);
    expect(conditionMatches(condition, { amount: '1', tokenAddress: 'USDC', timestamp: outsideWindow })).toBe(false);
  });

  it('matches time window that wraps past midnight', () => {
    const condition = { type: 'time', operator: 'between', value: '22:00', value2: '06:00' };
    const lateNight = new Date(Date.UTC(2026, 0, 1, 23, 30));
    const earlyMorning = new Date(Date.UTC(2026, 0, 1, 3, 0));
    const midday = new Date(Date.UTC(2026, 0, 1, 12, 0));
    expect(conditionMatches(condition, { amount: '1', tokenAddress: 'USDC', timestamp: lateNight })).toBe(true);
    expect(conditionMatches(condition, { amount: '1', tokenAddress: 'USDC', timestamp: earlyMorning })).toBe(true);
    expect(conditionMatches(condition, { amount: '1', tokenAddress: 'USDC', timestamp: midday })).toBe(false);
  });
});

describe('PaymentRoutingService', () => {
  let service: PaymentRoutingService;

  beforeEach(() => {
    service = new PaymentRoutingService();
    vi.clearAllMocks();
  });

  describe('createRule', () => {
    it('rejects a rule with no conditions', async () => {
      await expect(
        service.createRule({
          ownerAddress: OWNER,
          name: 'no-conditions',
          route: 'gateway-a',
          conditions: [],
        }),
      ).rejects.toThrow(/at least one condition/);
    });

    it('rejects an operator invalid for the condition type', async () => {
      await expect(
        service.createRule({
          ownerAddress: OWNER,
          name: 'bad-op',
          route: 'gateway-a',
          conditions: [{ type: 'amount', operator: 'equals' as never, value: '100' }],
        }),
      ).rejects.toThrow(/not valid for condition type/);
    });

    it('rejects a duplicate rule name for the same owner', async () => {
      (prisma.paymentRoutingRule.findFirst as any).mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.createRule({
          ownerAddress: OWNER,
          name: 'high-value',
          route: 'gateway-a',
          conditions: [{ type: 'amount', operator: 'gte', value: '1000' }],
        }),
      ).rejects.toThrow(/already exists/);
    });

    it('creates a rule with conditions', async () => {
      (prisma.paymentRoutingRule.findFirst as any).mockResolvedValueOnce(null);
      (prisma.paymentRoutingRule.create as any).mockResolvedValueOnce({ id: 'rule-1' });

      await service.createRule({
        ownerAddress: OWNER,
        name: 'high-value',
        route: 'gateway-a',
        conditions: [{ type: 'amount', operator: 'gte', value: '1000' }],
      });

      expect((prisma.paymentRoutingRule.create as any).mock.calls[0][0].data.conditions).toEqual({
        create: [{ type: 'amount', operator: 'gte', value: '1000' }],
      });
    });
  });

  describe('evaluate', () => {
    it('returns the first matching rule in priority order', async () => {
      (prisma.paymentRoutingRule.findMany as any).mockResolvedValueOnce([
        {
          id: 'rule-high-priority',
          name: 'large-usdc',
          route: 'gateway-priority',
          conditions: [
            { type: 'amount', operator: 'gte', value: '1000', value2: null },
            { type: 'asset', operator: 'equals', value: 'USDC', value2: null },
          ],
        },
        {
          id: 'rule-fallback',
          name: 'any-usdc',
          route: 'gateway-default',
          conditions: [{ type: 'asset', operator: 'equals', value: 'USDC', value2: null }],
        },
      ]);

      const result = await service.evaluate(OWNER, { amount: '5000', tokenAddress: 'USDC' });

      expect(result.matched).toBe(true);
      expect(result.route).toBe('gateway-priority');
      expect(result.rule?.id).toBe('rule-high-priority');
    });

    it('falls through to a lower-priority rule when a higher one does not match', async () => {
      (prisma.paymentRoutingRule.findMany as any).mockResolvedValueOnce([
        {
          id: 'rule-high-priority',
          name: 'large-usdc',
          route: 'gateway-priority',
          conditions: [{ type: 'amount', operator: 'gte', value: '1000', value2: null }],
        },
        {
          id: 'rule-fallback',
          name: 'any-usdc',
          route: 'gateway-default',
          conditions: [{ type: 'asset', operator: 'equals', value: 'USDC', value2: null }],
        },
      ]);

      const result = await service.evaluate(OWNER, { amount: '50', tokenAddress: 'USDC' });

      expect(result.matched).toBe(true);
      expect(result.route).toBe('gateway-default');
    });

    it('returns no match when no active rule matches', async () => {
      (prisma.paymentRoutingRule.findMany as any).mockResolvedValueOnce([
        {
          id: 'rule-1',
          name: 'eu-only',
          route: 'gateway-eu',
          conditions: [{ type: 'geography', operator: 'equals', value: 'EU', value2: null }],
        },
      ]);

      const result = await service.evaluate(OWNER, { amount: '50', tokenAddress: 'USDC', region: 'US' });

      expect(result.matched).toBe(false);
      expect(result.route).toBeNull();
    });

    it('only evaluates active rules', async () => {
      (prisma.paymentRoutingRule.findMany as any).mockResolvedValueOnce([]);

      await service.evaluate(OWNER, { amount: '50', tokenAddress: 'USDC' });

      expect((prisma.paymentRoutingRule.findMany as any).mock.calls[0][0].where).toEqual({
        ownerAddress: OWNER,
        isActive: true,
      });
    });
  });

  describe('testRule', () => {
    it('reports per-condition match results for a single rule', async () => {
      (prisma.paymentRoutingRule.findFirst as any).mockResolvedValueOnce({
        id: 'rule-1',
        conditions: [
          { type: 'amount', operator: 'gte', value: '1000', value2: null },
          { type: 'asset', operator: 'equals', value: 'USDC', value2: null },
        ],
      });

      const result = await service.testRule('rule-1', OWNER, { amount: '5000', tokenAddress: 'XLM' });

      expect(result.matched).toBe(false);
      expect(result.matchedConditions).toEqual([true, false]);
    });

    it('throws NotFoundError when the rule does not belong to the owner', async () => {
      (prisma.paymentRoutingRule.findFirst as any).mockResolvedValueOnce(null);

      await expect(
        service.testRule('missing-rule', OWNER, { amount: '1', tokenAddress: 'USDC' }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
