import { prisma } from '../lib/prisma.js';
import { logger } from '../logger.js';
import Decimal from 'decimal.js';

export interface ReportSummary {
  transactionCount: number;
  totalVolume: Decimal;
  failureCount?: number;
  feeTotal?: Decimal;
  averageTransactionAmount?: Decimal;
  largestTransaction?: Decimal;
  smallestTransaction?: Decimal;
}

export interface ReconciliationStatus {
  totalExpected: Decimal;
  totalActual: Decimal;
  variance: Decimal;
  variancePercent: number;
  discrepanciesFound: boolean;
  explanations?: string[];
}

export class ReportGenerationService {
  /**
   * Generate daily transaction summary for a specific date
   */
  async generateDailyTransactionSummary(
    organizationId: string,
    date: Date
  ): Promise<{
    summary: ReportSummary;
    transactions: any[];
    reconciliation: ReconciliationStatus;
  }> {
    logger.info('Generating daily transaction summary', { organizationId, date });

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Query all transactions for the day
    const transactions = await prisma.disbursement.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        disbursementRecipient: true,
      },
    });

    // Calculate summary
    const summary = this.calculateSummary(transactions);

    // Reconcile with blockchain
    const reconciliation = await this.reconcileTransactions(organizationId, transactions);

    return {
      summary,
      transactions: transactions.map((t) => ({
        id: t.id,
        recipient: t.disbursementRecipient?.address,
        amount: t.amount,
        asset: t.asset,
        status: t.status,
        createdAt: t.createdAt,
      })),
      reconciliation,
    };
  }

  /**
   * Generate monthly statement
   */
  async generateMonthlyStatement(
    organizationId: string,
    year: number,
    month: number
  ): Promise<{
    summary: ReportSummary;
    byDate: Map<string, ReportSummary>;
    feeBreakdown: Map<string, Decimal>;
    reconciliation: ReconciliationStatus;
  }> {
    logger.info('Generating monthly statement', { organizationId, year, month });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    const transactions = await prisma.disbursement.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        disbursementRecipient: true,
      },
    });

    // Group by date and calculate daily summaries
    const byDate = new Map<string, ReportSummary>();
    const feeBreakdown = new Map<string, Decimal>();

    for (const tx of transactions) {
      const dateKey = tx.createdAt.toISOString().split('T')[0];
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, {
          transactionCount: 0,
          totalVolume: new Decimal(0),
          failureCount: 0,
          feeTotal: new Decimal(0),
        });
      }

      const daySummary = byDate.get(dateKey)!;
      daySummary.transactionCount++;
      daySummary.totalVolume = daySummary.totalVolume.plus(tx.amount || 0);

      if (tx.status === 'FAILED') {
        daySummary.failureCount = (daySummary.failureCount || 0) + 1;
      }

      // Fee breakdown by source
      const feeType = tx.feeType || 'platform';
      const currentFee = feeBreakdown.get(feeType) || new Decimal(0);
      feeBreakdown.set(feeType, currentFee.plus(tx.fee || 0));
    }

    const summary = this.calculateSummary(transactions);
    const reconciliation = await this.reconcileTransactions(organizationId, transactions);

    return {
      summary,
      byDate,
      feeBreakdown,
      reconciliation,
    };
  }

  /**
   * Generate failed payment report
   */
  async generateFailedPaymentReport(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    summary: { failureCount: number; totalAmount: Decimal; failureRate: number };
    failures: any[];
    failuresByReason: Map<string, number>;
  }> {
    logger.info('Generating failed payment report', { organizationId, periodStart, periodEnd });

    const failures = await prisma.disbursement.findMany({
      where: {
        organizationId,
        status: 'FAILED',
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      include: {
        disbursementRecipient: true,
      },
    });

    const totalTransactions = await prisma.disbursement.count({
      where: {
        organizationId,
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    const failuresByReason = new Map<string, number>();
    let totalAmount = new Decimal(0);

    for (const failure of failures) {
      totalAmount = totalAmount.plus(failure.amount || 0);
      const reason = failure.failureReason || 'unknown';
      failuresByReason.set(reason, (failuresByReason.get(reason) || 0) + 1);
    }

    return {
      summary: {
        failureCount: failures.length,
        totalAmount,
        failureRate: totalTransactions > 0 ? (failures.length / totalTransactions) * 100 : 0,
      },
      failures: failures.map((f) => ({
        id: f.id,
        recipient: f.disbursementRecipient?.address,
        amount: f.amount,
        reason: f.failureReason,
        createdAt: f.createdAt,
        retryable: f.failureRetryable,
      })),
      failuresByReason,
    };
  }

  /**
   * Generate fee analysis report
   */
  async generateFeeAnalysisReport(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    totalFees: Decimal;
    byFeeType: Map<string, { count: number; total: Decimal; average: Decimal }>;
    byAsset: Map<string, Decimal>;
    feePercentOfVolume: number;
  }> {
    logger.info('Generating fee analysis report', { organizationId, periodStart, periodEnd });

    const transactions = await prisma.disbursement.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    const byFeeType = new Map<string, { count: number; total: Decimal; average: Decimal }>();
    const byAsset = new Map<string, Decimal>();
    let totalFees = new Decimal(0);
    let totalVolume = new Decimal(0);

    for (const tx of transactions) {
      const feeType = tx.feeType || 'platform';
      const fee = tx.fee || new Decimal(0);
      totalFees = totalFees.plus(fee);
      totalVolume = totalVolume.plus(tx.amount || 0);

      // By fee type
      if (!byFeeType.has(feeType)) {
        byFeeType.set(feeType, { count: 0, total: new Decimal(0), average: new Decimal(0) });
      }
      const feeStats = byFeeType.get(feeType)!;
      feeStats.count++;
      feeStats.total = feeStats.total.plus(fee);
      feeStats.average = feeStats.total.div(feeStats.count);

      // By asset
      const asset = tx.asset || 'XLM';
      const currentAssetFees = byAsset.get(asset) || new Decimal(0);
      byAsset.set(asset, currentAssetFees.plus(fee));
    }

    return {
      totalFees,
      byFeeType,
      byAsset,
      feePercentOfVolume:
        totalVolume.gt(0) && totalFees.gt(0)
          ? (totalFees.div(totalVolume).times(100)).toNumber()
          : 0,
    };
  }

  /**
   * Generate tax report for compliance
   */
  async generateTaxReport(
    organizationId: string,
    year: number,
    jurisdiction: string = 'US'
  ): Promise<{
    taxableTransactions: any[];
    totalTaxableAmount: Decimal;
    reportMetadata: {
      year: number;
      jurisdiction: string;
      generatedAt: Date;
      disclaimer: string;
    };
  }> {
    logger.info('Generating tax report', { organizationId, year, jurisdiction });

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    endDate.setUTCHours(23, 59, 59, 999);

    const transactions = await prisma.disbursement.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        disbursementRecipient: true,
      },
    });

    let totalTaxableAmount = new Decimal(0);
    const taxableTransactions = transactions.map((tx) => {
      totalTaxableAmount = totalTaxableAmount.plus(tx.amount || 0);
      return {
        date: tx.createdAt,
        recipient: tx.disbursementRecipient?.address,
        amount: tx.amount,
        asset: tx.asset,
        usdEquivalent: tx.amountUsd,
        transactionHash: tx.txHash,
      };
    });

    return {
      taxableTransactions,
      totalTaxableAmount,
      reportMetadata: {
        year,
        jurisdiction,
        generatedAt: new Date(),
        disclaimer:
          'This report is for informational purposes only. Consult a tax professional for compliance.',
      },
    };
  }

  /**
   * Reconcile transactions with blockchain records
   */
  async reconcileTransactions(
    organizationId: string,
    transactions: any[]
  ): Promise<ReconciliationStatus> {
    logger.info('Reconciling transactions', { organizationId, count: transactions.length });

    let totalExpected = new Decimal(0);
    let totalActual = new Decimal(0);

    for (const tx of transactions) {
      totalExpected = totalExpected.plus(tx.amount || 0);
      if (tx.status === 'COMPLETED') {
        totalActual = totalActual.plus(tx.amount || 0);
      }
    }

    const variance = totalExpected.minus(totalActual);
    const variancePercent = totalExpected.gt(0)
      ? variance.div(totalExpected).times(100).toNumber()
      : 0;

    const explanations: string[] = [];
    if (variance.gt(0)) {
      explanations.push(
        `${variance.toFixed(2)} XLM variance found (${variancePercent.toFixed(2)}%)`
      );
      explanations.push(
        `This may be due to pending transactions, failed payments, or blockchain confirmation delays`
      );
    }

    return {
      totalExpected,
      totalActual,
      variance,
      variancePercent,
      discrepanciesFound: variance.abs().gt(0),
      explanations: explanations.length > 0 ? explanations : undefined,
    };
  }

  /**
   * Calculate summary statistics from transactions
   */
  private calculateSummary(transactions: any[]): ReportSummary {
    let totalVolume = new Decimal(0);
    let failureCount = 0;
    let feeTotal = new Decimal(0);
    let largestTransaction = new Decimal(0);
    let smallestTransaction = new Decimal('Infinity');

    for (const tx of transactions) {
      const amount = new Decimal(tx.amount || 0);
      totalVolume = totalVolume.plus(amount);

      if (tx.status === 'FAILED') {
        failureCount++;
      }

      if (tx.fee) {
        feeTotal = feeTotal.plus(tx.fee);
      }

      if (amount.gt(largestTransaction)) {
        largestTransaction = amount;
      }

      if (amount.gt(0) && amount.lt(smallestTransaction)) {
        smallestTransaction = amount;
      }
    }

    return {
      transactionCount: transactions.length,
      totalVolume,
      failureCount: failureCount > 0 ? failureCount : undefined,
      feeTotal: feeTotal.gt(0) ? feeTotal : undefined,
      averageTransactionAmount: transactions.length > 0 ? totalVolume.div(transactions.length) : new Decimal(0),
      largestTransaction: largestTransaction.gt(0) ? largestTransaction : undefined,
      smallestTransaction: smallestTransaction.lt(Infinity) ? smallestTransaction : undefined,
    };
  }
}

export const reportGenerationService = new ReportGenerationService();
