import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeeOptimizationService } from './fee-optimization.service.js';

const { mockEvaluate, mockPrismaQueryRaw, mockPrismaFindMany, mockPrismaFindFirst } = vi.hoisted(() => ({
  mockEvaluate: vi.fn(),
  mockPrismaQueryRaw: vi.fn(),
  mockPrismaFindMany: vi.fn(),
  mockPrismaFindFirst: vi.fn(),
}));

vi.mock('../lib/db.js', () => ({
  prisma: {
    $queryRaw: mockPrismaQueryRaw,
    paymentRoutingRule: {
      findMany: mockPrismaFindMany,
    },
    tokenPrice: {
      findFirst: mockPrismaFindFirst,
    },
  },
}));

vi.mock('./payment-routing.service.js', () => ({
  PaymentRoutingService: vi.fn().mockImplementation(function() {
    return { evaluate: mockEvaluate };
  }),
}));

describe('FeeOptimizationService', () => {
  let service: FeeOptimizationService;

  beforeEach(() => {
    service = new FeeOptimizationService();
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Best Time to Process
  // ═══════════════════════════════════════════════════════════════════

  describe('findBestTimeToProcess', () => {
    it('returns BestTimeResult with 7×24 grid when fee data exists', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { day_of_week: 1, hour_of_day: 10, avg_fee: 80, cnt: 50n },
        { day_of_week: 1, hour_of_day: 11, avg_fee: 120, cnt: 30n },
        { day_of_week: 3, hour_of_day: 14, avg_fee: 200, cnt: 20n },
      ]);

      const result = await service.findBestTimeToProcess();

      expect(result.windows).toHaveLength(168);
      expect(result.bestWindow).toBeDefined();
      expect(result.bestWindow.averageFeeStroops).toBeGreaterThan(0);
      expect(result.cheapestDay).toBeDefined();
      expect(result.cheapestDay.day).toBeDefined();
      expect(result.cheapestHour).toBeDefined();
      expect(result.cheapestHour.hour).toBeGreaterThanOrEqual(0);
      expect(result.recommendation).toBeTruthy();
      expect(result.metadata.model).toBe('historical-hourly-aggregation');
    });

    it('returns fallback grid when no fee data exists', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([]);

      const result = await service.findBestTimeToProcess();

      expect(result.windows).toHaveLength(168);
      expect(result.bestWindow).toBeDefined();
    });

    it('populates sampleCount from query results', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { day_of_week: 2, hour_of_day: 8, avg_fee: 90, cnt: 100n },
      ]);

      const result = await service.findBestTimeToProcess();

      const tuesday8am = result.windows.find(
        (w) => w.dayOfWeek === 2 && w.hourOfDay === 8
      );
      expect(tuesday8am).toBeDefined();
      expect(tuesday8am!.sampleCount).toBe(100);
    });

    it('throws error when query fails', async () => {
      mockPrismaQueryRaw.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.findBestTimeToProcess()).rejects.toThrow('DB error');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Optimal Batching
  // ═══════════════════════════════════════════════════════════════════

  describe('computeOptimalBatching', () => {
    it('recommends batch size > 1 for large payment counts', async () => {
      const result = await service.computeOptimalBatching({
        paymentCount: 100,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 50,
      });

      expect(result.recommendedBatchSize).toBeGreaterThan(1);
      expect(result.estimatedSavingsPercent).toBeGreaterThan(0);
      expect(result.estimatedSavingsStroops).toBeGreaterThan(0);
      expect(result.breakdown.length).toBe(100);
    });

    it('recommends batch size 1 for a single payment', async () => {
      const result = await service.computeOptimalBatching({
        paymentCount: 1,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 50,
      });

      expect(result.recommendedBatchSize).toBe(1);
      // With 1 payment, batching adds overhead so savings are negative
      expect(result.estimatedSavingsPercent).toBeLessThan(0);
      expect(result.estimatedSavingsStroops).toBeLessThan(0);
    });

    it('handles zero fixed overhead gracefully', async () => {
      const result = await service.computeOptimalBatching({
        paymentCount: 50,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 0,
      });

      expect(result.recommendedBatchSize).toBeGreaterThanOrEqual(1);
      expect(result.estimatedSavingsPercent).toBeGreaterThanOrEqual(0);
    });

    it('caps max batch size at 100', async () => {
      const result = await service.computeOptimalBatching({
        paymentCount: 1000,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 50,
      });

      expect(result.breakdown.length).toBe(100);
    });

    it('outputs valid XLM string format', async () => {
      const result = await service.computeOptimalBatching({
        paymentCount: 100,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 50,
      });

      expect(result.estimatedSavingsXlm).toMatch(/^\d+\.\d{7}$/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Route Selection
  // ═══════════════════════════════════════════════════════════════════

  describe('selectOptimalRoute', () => {
    const mockContext = {
      amount: '1000',
      tokenAddress: 'USDC',
      region: 'US',
    };
    const ownerAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    it('recommends the cheapest route', async () => {
      mockEvaluate.mockResolvedValueOnce({
        matched: true,
        rule: { id: 'rule-1', name: 'test', route: 'gateway-a' },
        route: 'gateway-a',
      });
      mockPrismaFindMany.mockResolvedValueOnce([
        { route: 'gateway-a' },
        { route: 'gateway-b' },
      ]);

      const result = await service.selectOptimalRoute(mockContext, ownerAddress);

      expect(result.context).toEqual(mockContext);
      expect(result.estimates.length).toBeGreaterThanOrEqual(1);
      expect(result.recommendedRoute.isRecommended).toBe(true);
    });

    it('returns default route when no rules match', async () => {
      mockEvaluate.mockResolvedValueOnce({
        matched: false,
        rule: null,
        route: null,
      });
      mockPrismaFindMany.mockResolvedValueOnce([]);

      const result = await service.selectOptimalRoute(mockContext, ownerAddress);

      expect(result.estimates.length).toBeGreaterThanOrEqual(1);
      expect(result.estimates[0].route).toBe('default');
    });

    it('calculates savings against the default route', async () => {
      mockEvaluate.mockResolvedValueOnce({
        matched: true,
        rule: { id: 'rule-1', name: 'test', route: 'gateway-priority' },
        route: 'gateway-priority',
      });
      mockPrismaFindMany.mockResolvedValueOnce([
        { route: 'gateway-priority' },
        { route: 'default' },
      ]);

      const result = await service.selectOptimalRoute(mockContext, ownerAddress);

      expect(result.estimatedSavingsStroops).toBeGreaterThan(0);
    });

    it('handles evaluation errors', async () => {
      mockEvaluate.mockRejectedValueOnce(new Error('Routing error'));

      await expect(
        service.selectOptimalRoute(mockContext, ownerAddress)
      ).rejects.toThrow('Routing error');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Fee Prediction
  // ═══════════════════════════════════════════════════════════════════

  describe('predictFees', () => {
    it('returns predictions based on historical fee data', async () => {
      const dailyFees = [];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      for (let i = 0; i < 30; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        dailyFees.push({
          day: d.toISOString().split('T')[0],
          avg_fee: 100 + Math.sin(i * 0.5) * 20,
          cnt: BigInt(50),
        });
      }
      mockPrismaQueryRaw.mockResolvedValueOnce(dailyFees);

      const result = await service.predictFees(2);

      expect(result.predictions.length).toBe(14);
      expect(result.currentFeeStroops).toBeGreaterThan(0);
      expect(['falling', 'stable', 'rising']).toContain(result.trend);
      expect(result.recommendation).toBeTruthy();
      expect(result.metadata.model).toBe('exponential-smoothing');
    });

    it('returns fallback when insufficient data', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { day: '2026-01-01', avg_fee: 100, cnt: 10n },
        { day: '2026-01-02', avg_fee: 110, cnt: 15n },
      ]);

      const result = await service.predictFees(2);

      expect(result.metadata.model).toBe('fallback-default');
      expect(result.predictions.length).toBe(14);
      expect(result.currentFeeStroops).toBe(100);
    });

    it('handles empty data', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([]);

      const result = await service.predictFees(4);

      expect(result.metadata.model).toBe('fallback-default');
      expect(result.predictions.length).toBe(28);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Cost Analysis
  // ═══════════════════════════════════════════════════════════════════

  describe('analyzeCosts', () => {
    it('returns cost report with entries and savings', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { week: '2026-W27', avg_fee: 150, total_fee: 15000, tx_count: 100n },
        { week: '2026-W28', avg_fee: 140, total_fee: 14000, tx_count: 100n },
        { week: '2026-W29', avg_fee: 130, total_fee: 13000, tx_count: 100n },
      ]);
      mockPrismaFindFirst.mockResolvedValueOnce({ priceUsd: 0.1 });

      const result = await service.analyzeCosts(4);

      expect(result.entries).toHaveLength(3);
      expect(result.totalSavingsStroops).toBeGreaterThan(0);
      expect(result.totalSavingsXlm).toMatch(/^\d+\.\d{7}$/);
      expect(typeof result.optimizationAchieved).toBe('boolean');
    });

    it('reports optimizationAchieved=false when savings below 20%', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { week: '2026-W27', avg_fee: 105, total_fee: 1050, tx_count: 10n },
        { week: '2026-W28', avg_fee: 102, total_fee: 1020, tx_count: 10n },
      ]);
      mockPrismaFindFirst.mockResolvedValueOnce({ priceUsd: 0.1 });

      const result = await service.analyzeCosts(4);

      expect(result.averageSavingsPercent).toBeLessThan(20);
      expect(result.optimizationAchieved).toBe(false);
    });

    it('handles empty fee data', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([]);
      mockPrismaFindFirst.mockResolvedValueOnce({ priceUsd: 0.1 });

      const result = await service.analyzeCosts(4);

      expect(result.entries).toHaveLength(0);
      expect(result.totalSavingsStroops).toBe(0);
      expect(result.optimizationAchieved).toBe(false);
    });

    it('handles XLM price lookup failure', async () => {
      mockPrismaQueryRaw.mockResolvedValueOnce([
        { week: '2026-W27', avg_fee: 100, total_fee: 10000, tx_count: 100n },
      ]);
      mockPrismaFindFirst.mockResolvedValueOnce(null);

      const result = await service.analyzeCosts(4);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].xlmPrice).toBe(0.1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Auto Optimization
  // ═══════════════════════════════════════════════════════════════════

  describe('runAutoOptimization', () => {
    const ownerAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    beforeEach(() => {
      mockPrismaQueryRaw.mockImplementation((query: any) => {
        const queryStr = String(query);
        if (queryStr.includes('DOW')) {
          return Promise.resolve([
            { day_of_week: 1, hour_of_day: 10, avg_fee: 80, cnt: 50n },
            { day_of_week: 3, hour_of_day: 14, avg_fee: 200, cnt: 20n },
          ]);
        }
        if (queryStr.includes('IYYY-IW')) {
          return Promise.resolve([
            { week: '2026-W27', avg_fee: 150, total_fee: 15000, tx_count: 100n },
            { week: '2026-W28', avg_fee: 140, total_fee: 14000, tx_count: 100n },
          ]);
        }
        if (queryStr.includes('YYYY-MM-DD')) {
          const dailyFees = [];
          for (let i = 0; i < 30; i++) {
            const d = new Date();
            d.setDate(d.getDate() - 30 + i);
            dailyFees.push({
              day: d.toISOString().split('T')[0],
              avg_fee: 100 + Math.sin(i * 0.5) * 20,
              cnt: BigInt(50),
            });
          }
          return Promise.resolve(dailyFees);
        }
        return Promise.resolve([]);
      });
      mockPrismaFindFirst.mockResolvedValue({ priceUsd: 0.1 });
      mockEvaluate.mockResolvedValue({
        matched: true,
        rule: { id: 'rule-1', name: 'test', route: 'gateway-priority' },
        route: 'gateway-priority',
      });
      mockPrismaFindMany.mockResolvedValue([
        { route: 'gateway-priority' },
        { route: 'default' },
      ]);
    });

    it('returns optimization actions and savings estimates', async () => {
      const context = { amount: '5000', tokenAddress: 'USDC' };
      const result = await service.runAutoOptimization(ownerAddress, context);

      expect(result.actions.length).toBeGreaterThanOrEqual(1);
      expect(result.totalEstimatedSavingsStroops).toBeGreaterThan(0);
      expect(result.totalEstimatedSavingsXlm).toMatch(/^\d+\.\d{7}$/);
      expect(typeof result.savingsTargetMet).toBe('boolean');
      expect(result.recommendation).toBeTruthy();
      expect(result.metadata.model).toBe('comprehensive-fee-optimization');
    });

    it('returns actions with proper priority levels', async () => {
      const result = await service.runAutoOptimization(ownerAddress);

      for (const action of result.actions) {
        expect(['high', 'medium', 'low']).toContain(action.priority);
        expect(['batch', 'route', 'timing']).toContain(action.type);
        expect(action.description).toBeTruthy();
        expect(action.estimatedSavingsStroops).toBeGreaterThanOrEqual(0);
      }
    });

    it('works without routing context', async () => {
      const result = await service.runAutoOptimization(ownerAddress);

      expect(result.actions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. Optimization Summary
  // ═══════════════════════════════════════════════════════════════════

  describe('generateOptimizationSummary', () => {
    beforeEach(() => {
      mockPrismaQueryRaw.mockImplementation((query: any) => {
        const queryStr = String(query);
        if (queryStr.includes('DOW')) {
          return Promise.resolve([
            { day_of_week: 1, hour_of_day: 10, avg_fee: 80, cnt: 50n },
          ]);
        }
        if (queryStr.includes('IYYY-IW')) {
          return Promise.resolve([
            { week: '2026-W27', avg_fee: 150, total_fee: 15000, tx_count: 100n },
          ]);
        }
        if (queryStr.includes('YYYY-MM-DD')) {
          const dailyFees = [];
          for (let i = 0; i < 30; i++) {
            const d = new Date();
            d.setDate(d.getDate() - 30 + i);
            dailyFees.push({
              day: d.toISOString().split('T')[0],
              avg_fee: 100,
              cnt: BigInt(50),
            });
          }
          return Promise.resolve(dailyFees);
        }
        return Promise.resolve([]);
      });
      mockPrismaFindFirst.mockResolvedValue({ priceUsd: 0.1 });
    });

    it('returns comprehensive optimization summary', async () => {
      const result = await service.generateOptimizationSummary();

      expect(result.feePrediction).toBeDefined();
      expect(result.bestTime).toBeDefined();
      expect(result.batchOptimization).toBeDefined();
      expect(result.costReport).toBeDefined();
      expect(result.totalPotentialSavingsStroops).toBeGreaterThan(0);
      expect(result.totalPotentialSavingsXlm).toMatch(/^\d+\.\d{7}$/);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('includes actionable recommendations', async () => {
      const result = await service.generateOptimizationSummary();

      for (const rec of result.recommendations) {
        expect(typeof rec).toBe('string');
        expect(rec.length).toBeGreaterThan(10);
      }
    });
  });
});