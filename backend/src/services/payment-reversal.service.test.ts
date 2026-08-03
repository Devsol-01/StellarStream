import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentReversalService } from './payment-reversal.service.js';

vi.mock('../lib/db.js', () => {
  const mockPrismaFindUnique = vi.fn();
  const mockPrismaQueryRaw = vi.fn();
  const mockPrismaExecuteRaw = vi.fn();
  const mockDisbursementUpdate = vi.fn().mockResolvedValue({});
  
  const createTransactionMock = () => {
    return vi.fn().mockImplementation((fn: any) => fn({
      $queryRaw: mockPrismaQueryRaw,
      $executeRaw: mockPrismaExecuteRaw,
      disbursement: {
        update: mockDisbursementUpdate,
      },
    }));
  };

  return {
    prisma: {
      disbursement: {
        findUnique: mockPrismaFindUnique,
        update: mockDisbursementUpdate,
      },
      $queryRaw: mockPrismaQueryRaw,
      $executeRaw: mockPrismaExecuteRaw,
      $transaction: createTransactionMock(),
    },
  };
});

describe('PaymentReversalService', () => {
  let service: PaymentReversalService;

  beforeEach(() => {
    service = new PaymentReversalService();
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Create Reversal
  // ═══════════════════════════════════════════════════════════════════

  describe('createReversal', () => {
    it('creates a full reversal when amount is omitted', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ total_reversed: '0' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '100000000',
        amountXlm: '10.0000000',
        reason: 'customer_request',
        reasonDetails: '',
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.createReversal({
        disbursementId: 'disb-1',
        reason: 'customer_request',
        requestedBy: 'user-1',
      });

      expect(result.id).toBe('reversal-1');
      expect(result.amountStroops).toBe('100000000');
      expect(result.status).toBe('PENDING');
    });

    it('creates a partial reversal when amount is provided', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ total_reversed: '0' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'incorrect_amount',
        reasonDetails: '',
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.createReversal({
        disbursementId: 'disb-1',
        amount: '50000000',
        reason: 'incorrect_amount',
        requestedBy: 'user-1',
      });

      expect(result.amountStroops).toBe('50000000');
    });

    it('throws NotFoundError for non-existent disbursement', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce(null);

      await expect(
        service.createReversal({
          disbursementId: 'non-existent',
          reason: 'customer_request',
          requestedBy: 'user-1',
        })
      ).rejects.toThrow('Disbursement');
    });

    it('throws BusinessRuleError for non-COMPLETED disbursement', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'PENDING',
        createdAt: new Date(),
      });

      await expect(
        service.createReversal({
          disbursementId: 'disb-1',
          reason: 'customer_request',
          requestedBy: 'user-1',
        })
      ).rejects.toThrow('COMPLETED');
    });

    it('throws BusinessRuleError for disbursement older than 30 days', async () => {
      const { prisma } = await import('../lib/db.js');
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);

      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: oldDate,
      });

      await expect(
        service.createReversal({
          disbursementId: 'disb-1',
          reason: 'customer_request',
          requestedBy: 'user-1',
        })
      ).rejects.toThrow('too old');
    });

    it('throws ValidationError when reversal amount exceeds disbursement amount', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });

      await expect(
        service.createReversal({
          disbursementId: 'disb-1',
          amount: '150000000',
          reason: 'customer_request',
          requestedBy: 'user-1',
        })
      ).rejects.toThrow('cannot exceed');
    });

    it('throws BusinessRuleError when daily limit is exceeded', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '200000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ total_reversed: '900000000' }]);

      await expect(
        service.createReversal({
          disbursementId: 'disb-1',
          amount: '200000000',
          reason: 'customer_request',
          requestedBy: 'user-1',
        })
      ).rejects.toThrow('Daily reversal limit exceeded');
    });

    it('creates audit trail entry', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ total_reversed: '0' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'fraud',
        reasonDetails: 'Suspicious activity',
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.createReversal({
        disbursementId: 'disb-1',
        amount: '50000000',
        reason: 'fraud',
        reasonDetails: 'Suspicious activity',
        requestedBy: 'user-1',
      });

      expect(result.auditTrail.length).toBeGreaterThanOrEqual(1);
      expect(result.auditTrail[0].action).toBe('CREATED');
    });

    it('updates disbursement to REFUNDED for full reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.disbursement.findUnique as any).mockResolvedValueOnce({
        id: 'disb-1',
        amount: '100000000',
        status: 'COMPLETED',
        createdAt: new Date(),
      });
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ total_reversed: '0' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '100000000',
        amountXlm: '10.0000000',
        reason: 'customer_request',
        reasonDetails: '',
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      await service.createReversal({
        disbursementId: 'disb-1',
        reason: 'customer_request',
        requestedBy: 'user-1',
      });

      expect(prisma.$executeRaw).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Disbursement"'),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Process Reversal
  // ═══════════════════════════════════════════════════════════════════

  describe('processReversal', () => {
    it('processes a pending reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.processReversal('reversal-1');

      expect(result.status).toBe('COMPLETED');
      expect(result.processedAt).toBeDefined();
    });

    it('throws ConflictError for non-PENDING reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'COMPLETED',
        requestedBy: 'user-1',
        processedAt: new Date(),
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);

      await expect(service.processReversal('reversal-1')).rejects.toThrow('COMPLETED');
    });

    it('creates audit trail for processing and completion', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.processReversal('reversal-1');

      const processingEntry = result.auditTrail.find(a => a.action === 'PROCESSING');
      const completedEntry = result.auditTrail.find(a => a.action === 'COMPLETED');

      expect(processingEntry).toBeDefined();
      expect(completedEntry).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Cancel Reversal
  // ═══════════════════════════════════════════════════════════════════

  describe('cancelReversal', () => {
    it('cancels a pending reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.cancelReversal('reversal-1', 'admin-1', 'User requested');

      expect(result.status).toBe('CANCELLED');
    });

    it('throws ConflictError for completed reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'COMPLETED',
        requestedBy: 'user-1',
        processedAt: new Date(),
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);

      await expect(
        service.cancelReversal('reversal-1', 'admin-1')
      ).rejects.toThrow('Cannot cancel');
    });

    it('throws ConflictError for already cancelled reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'CANCELLED',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);

      await expect(
        service.cancelReversal('reversal-1', 'admin-1')
      ).rejects.toThrow('already cancelled');
    });

    it('creates audit trail for cancellation', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.cancelReversal('reversal-1', 'admin-1', 'Duplicate');

      expect(result.auditTrail.length).toBeGreaterThanOrEqual(1);
      expect(result.auditTrail[0].action).toBe('CANCELLED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Read Operations
  // ═══════════════════════════════════════════════════════════════════

  describe('getReversal', () => {
    it('returns a reversal by ID', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.getReversal('reversal-1');

      expect(result.id).toBe('reversal-1');
      expect(result.auditTrail).toBeDefined();
    });

    it('throws NotFoundError for non-existent reversal', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      await expect(service.getReversal('non-existent')).rejects.toThrow('Reversal');
    });
  });

  describe('getReversalsForDisbursement', () => {
    it('returns all reversals for a disbursement', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.getReversalsForDisbursement('disb-1');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('reversal-1');
    });
  });

  describe('getReversalsByUser', () => {
    it('returns reversals for a user with default limit', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.getReversalsByUser('user-1');

      expect(result.length).toBe(1);
    });

    it('respects custom limit', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'reversal-1' }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([{
        id: 'reversal-1',
        disbursementId: 'disb-1',
        amountStroops: '50000000',
        amountXlm: '5.0000000',
        reason: 'customer_request',
        reasonDetails: null,
        status: 'PENDING',
        requestedBy: 'user-1',
        processedAt: null,
        createdAt: new Date(),
        previousReversalAmountStroops: '0',
        remainingReversableStroops: '100000000',
      }]);
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.getReversalsByUser('user-1', 10);

      expect(result.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Statistics & Limits
  // ═══════════════════════════════════════════════════════════════════

  describe('getUserReversalStats', () => {
    it('returns statistics for a user', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([
        { reason: 'customer_request', status: 'COMPLETED', amount_stroops: '50000000', count: 2n },
        { reason: 'fraud', status: 'PENDING', amount_stroops: '100000000', count: 1n },
      ]);

      const result = await service.getUserReversalStats('user-1');

      expect(result.totalReversals).toBe(3);
      expect(result.totalReversedStroops).toBe('150000000');
      expect(result.byReason['customer_request']).toBe(2);
      expect(result.byStatus['COMPLETED']).toBe(2);
    });

    it('returns empty stats for user with no reversals', async () => {
      const { prisma } = await import('../lib/db.js');
      (prisma.$queryRaw as any).mockResolvedValueOnce([]);

      const result = await service.getUserReversalStats('user-1');

      expect(result.totalReversals).toBe(0);
      expect(result.totalReversedStroops).toBe('0');
    });
  });

  describe('getReversalLimits', () => {
    it('returns configured limits', () => {
      const limits = service.getReversalLimits();

      expect(limits.maxReversalPercent).toBe(100);
      expect(limits.maxDailyReversalStroops).toBe('1000000000');
      expect(limits.maxReversalAgeDays).toBe(30);
    });
  });
});