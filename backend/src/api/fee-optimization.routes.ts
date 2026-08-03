/**
 * Fee Optimization API Routes (Issue #1363)
 *
 * REST API for the fee optimization service, providing endpoints for:
 *  - Best time to process analysis
 *  - Optimal batching recommendations
 *  - Route selection
 *  - Fee prediction
 *  - Cost analysis and reporting
 *  - Automatic optimization
 *
 * All routes are mounted under /api/v1/fee-optimization
 */

import { Router, Request, Response } from "express";
import { FeeOptimizationService } from "../services/fee-optimization.service.js";
import { logger } from "../logger.js";
import type { PaymentRoutingContext } from "../services/payment-routing.service.js";

const router = Router();
const feeOptimizationService = new FeeOptimizationService();

/**
 * GET /api/v1/fee-optimization/best-time
 *
 * Analyze historical fee data to identify the cheapest times to process
 * transactions. Returns a 7×24 grid of average fees and rankings.
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     windows: FeeWindow[],
 *     bestWindow: FeeWindow,
 *     cheapestDay: { day, averageFeeStroops },
 *     cheapestHour: { hour, averageFeeStroops },
 *     recommendation: string,
 *     metadata: { ... }
 *   }
 * }
 */
router.get("/best-time", async (_req: Request, res: Response) => {
  try {
    const data = await feeOptimizationService.findBestTimeToProcess();
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to find best time to process", error);
    res.status(500).json({
      success: false,
      error: "Failed to analyze best time to process transactions.",
    });
  }
});

/**
 * GET /api/v1/fee-optimization/batching
 *
 * Compute the optimal batch size for minimizing fees per payment.
 *
 * Query Parameters:
 *  - paymentCount: number (default: 100, max: 10000)
 *  - averagePaymentFeeStroops: number (default: 100)
 *  - fixedOverheadStroops: number (default: 50)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     recommendedBatchSize: number,
 *     estimatedSavingsPercent: number,
 *     estimatedSavingsStroops: number,
 *     estimatedSavingsXlm: string,
 *     breakdown: [...],
 *     metadata: { ... }
 *   }
 * }
 */
router.get("/batching", async (req: Request, res: Response) => {
  try {
    const paymentCount = Math.min(
      Math.max(parseInt(req.query.paymentCount as string) || 100, 1),
      10000
    );
    const averagePaymentFeeStroops = Math.max(
      parseInt(req.query.averagePaymentFeeStroops as string) || 100,
      1
    );
    const fixedOverheadStroops = Math.max(
      parseInt(req.query.fixedOverheadStroops as string) || 50,
      0
    );

    const data = await feeOptimizationService.computeOptimalBatching({
      paymentCount,
      averagePaymentFeeStroops,
      fixedOverheadStroops,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to compute optimal batching", error);
    res.status(500).json({
      success: false,
      error: "Failed to compute optimal batch size.",
    });
  }
});

/**
 * POST /api/v1/fee-optimization/route
 *
 * Select the optimal route for a payment context. Evaluates routing rules
 * and historical fee data to recommend the cheapest route.
 *
 * Request Body:
 * {
 *   ownerAddress: string,
 *   context: {
 *     amount: string,
 *     tokenAddress: string,
 *     region?: string,
 *     timestamp?: string
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     context: PaymentRoutingContext,
 *     estimates: RouteFeeEstimate[],
 *     recommendedRoute: RouteFeeEstimate,
 *     estimatedSavingsStroops: number,
 *     estimatedSavingsPercent: number,
 *     metadata: { ... }
 *   }
 * }
 */
router.post("/route", async (req: Request, res: Response) => {
  try {
    const { ownerAddress, context } = req.body as {
      ownerAddress: string;
      context: PaymentRoutingContext;
    };

    if (!ownerAddress) {
      res.status(400).json({
        success: false,
        error: "ownerAddress is required.",
      });
      return;
    }

    if (!context || !context.amount || !context.tokenAddress) {
      res.status(400).json({
        success: false,
        error: "context with amount and tokenAddress is required.",
      });
      return;
    }

    // Parse optional timestamp
    const routingContext: PaymentRoutingContext = {
      amount: context.amount,
      tokenAddress: context.tokenAddress,
      region: context.region,
      timestamp: context.timestamp ? new Date(context.timestamp) : undefined,
    };

    const data = await feeOptimizationService.selectOptimalRoute(
      routingContext,
      ownerAddress,
    );
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to select optimal route", error);
    res.status(500).json({
      success: false,
      error: "Failed to select optimal payment route.",
    });
  }
});

/**
 * GET /api/v1/fee-optimization/predictions
 *
 * Predict future transaction fees using exponential smoothing of
 * historical fee data.
 *
 * Query Parameters:
 *  - weeks: number (default: 4, max: 12)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     predictions: FeePrediction[],
 *     currentFeeStroops: number,
 *     trend: 'falling' | 'stable' | 'rising',
 *     recommendation: string,
 *     metadata: { ... }
 *   }
 * }
 */
router.get("/predictions", async (req: Request, res: Response) => {
  try {
    const weeks = Math.min(Math.max(parseInt(req.query.weeks as string) || 4, 1), 12);
    const data = await feeOptimizationService.predictFees(weeks);
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to predict fees", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate fee predictions.",
    });
  }
});

/**
 * GET /api/v1/fee-optimization/cost-report
 *
 * Generate a cost analysis report comparing actual fees paid vs.
 * estimated optimal fees.
 *
 * Query Parameters:
 *  - weeks: number (default: 4, max: 12)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     entries: CostReportEntry[],
 *     totalSavingsStroops: number,
 *     totalSavingsXlm: string,
 *     totalSavingsUsd: number,
 *     averageSavingsPercent: number,
 *     optimizationAchieved: boolean,
 *     metadata: { ... }
 *   }
 * }
 */
router.get("/cost-report", async (req: Request, res: Response) => {
  try {
    const weeks = Math.min(Math.max(parseInt(req.query.weeks as string) || 4, 1), 12);
    const data = await feeOptimizationService.analyzeCosts(weeks);
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to generate cost report", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate cost analysis report.",
    });
  }
});

/**
 * POST /api/v1/fee-optimization/auto-optimize
 *
 * Run all optimization analyses and produce an automatic optimization
 * report with prioritized actions.
 *
 * Request Body:
 * {
 *   ownerAddress: string,
 *   context?: {
 *     amount: string,
 *     tokenAddress: string,
 *     region?: string,
 *     timestamp?: string
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     actions: FeeOptimizationAction[],
 *     totalEstimatedSavingsStroops: number,
 *     totalEstimatedSavingsXlm: string,
 *     totalEstimatedSavingsPercent: number,
 *     savingsTargetMet: boolean,
 *     recommendation: string,
 *     metadata: { ... }
 *   }
 * }
 */
router.post("/auto-optimize", async (req: Request, res: Response) => {
  try {
    const { ownerAddress, context } = req.body as {
      ownerAddress: string;
      context?: PaymentRoutingContext;
    };

    if (!ownerAddress) {
      res.status(400).json({
        success: false,
        error: "ownerAddress is required.",
      });
      return;
    }

    let routingContext: PaymentRoutingContext | undefined;
    if (context && context.amount && context.tokenAddress) {
      routingContext = {
        amount: context.amount,
        tokenAddress: context.tokenAddress,
        region: context.region,
        timestamp: context.timestamp ? new Date(context.timestamp) : undefined,
      };
    }

    const data = await feeOptimizationService.runAutoOptimization(
      ownerAddress,
      routingContext,
    );
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to run auto optimization", error);
    res.status(500).json({
      success: false,
      error: "Failed to run automatic fee optimization.",
    });
  }
});

/**
 * GET /api/v1/fee-optimization/summary
 *
 * Generate a comprehensive optimization summary combining all analyses
 * with actionable recommendations.
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     feePrediction: FeePredictionResult,
 *     bestTime: BestTimeResult,
 *     batchOptimization: BatchOptimizationResult,
 *     costReport: CostReport,
 *     totalPotentialSavingsStroops: number,
 *     totalPotentialSavingsXlm: string,
 *     recommendations: string[]
 *   }
 * }
 */
router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const data = await feeOptimizationService.generateOptimizationSummary();
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to generate optimization summary", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate fee optimization summary.",
    });
  }
});

/**
 * GET /api/v1/fee-optimization
 *
 * Combined overview of all fee optimization analyses.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [bestTime, batchOpt, feePrediction, costReport] = await Promise.all([
      feeOptimizationService.findBestTimeToProcess(),
      feeOptimizationService.computeOptimalBatching({
        paymentCount: 100,
        averagePaymentFeeStroops: 100,
        fixedOverheadStroops: 50,
      }),
      feeOptimizationService.predictFees(4),
      feeOptimizationService.analyzeCosts(4),
    ]);

    res.json({
      success: true,
      data: {
        bestTime,
        batchOptimization: batchOpt,
        feePrediction,
        costReport,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Failed to generate fee optimization overview", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate fee optimization overview.",
    });
  }
});

export default router;