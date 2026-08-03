/**
 * Payment Reversal API Routes (Issue #1374)
 *
 * REST API for payment reversals and refunds.
 * All routes are mounted under /api/v1/reversals
 */

import { Router, Request, Response } from "express";
import { PaymentReversalService } from "../services/payment-reversal.service.js";
import { logger } from "../logger.js";

const router = Router();
const reversalService = new PaymentReversalService();

/**
 * POST /api/v1/reversals
 *
 * Create a new reversal (full or partial) for a disbursement.
 *
 * Request Body:
 * {
 *   disbursementId: string,
 *   amount?: string,  // optional, omit for full reversal
 *   reason: "duplicate_payment" | "incorrect_amount" | "recipient_error" | "fraud" | "customer_request" | "technical_error" | "other",
 *   reasonDetails?: string,
 *   requestedBy: string
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { disbursementId, amount, reason, reasonDetails, requestedBy } = req.body;

    if (!disbursementId || !reason || !requestedBy) {
      res.status(400).json({
        success: false,
        error: "disbursementId, reason, and requestedBy are required",
      });
      return;
    }

    const result = await reversalService.createReversal({
      disbursementId,
      amount,
      reason,
      reasonDetails,
      requestedBy,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to create reversal", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create reversal",
    });
  }
});

/**
 * POST /api/v1/reversals/:id/process
 *
 * Process a pending reversal (simulate refund execution).
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult
 * }
 */
router.post("/:id/process", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    const result = await reversalService.processReversal(id, txHash);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to process reversal", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to process reversal",
    });
  }
});

/**
 * POST /api/v1/reversals/:id/cancel
 *
 * Cancel a pending or processing reversal.
 *
 * Request Body:
 * {
 *   cancelledBy: string,
 *   reason?: string
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult
 * }
 */
router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cancelledBy, reason } = req.body;

    if (!cancelledBy) {
      res.status(400).json({
        success: false,
        error: "cancelledBy is required",
      });
      return;
    }

    const result = await reversalService.cancelReversal(id, cancelledBy, reason);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to cancel reversal", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to cancel reversal",
    });
  }
});

/**
 * GET /api/v1/reversals/:id
 *
 * Get a single reversal by ID with audit trail.
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult
 * }
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await reversalService.getReversal(id);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to get reversal", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get reversal",
    });
  }
});

/**
 * GET /api/v1/reversals/disbursement/:disbursementId
 *
 * Get all reversals for a disbursement.
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult[]
 * }
 */
router.get("/disbursement/:disbursementId", async (req: Request, res: Response) => {
  try {
    const { disbursementId } = req.params;

    const result = await reversalService.getReversalsForDisbursement(disbursementId);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to get reversals for disbursement", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get reversals",
    });
  }
});

/**
 * GET /api/v1/reversals/user/:requestedBy
 *
 * Get reversals requested by a specific user.
 *
 * Query Parameters:
 *  - limit: number (default: 50, max: 200)
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalResult[]
 * }
 */
router.get("/user/:requestedBy", async (req: Request, res: Response) => {
  try {
    const { requestedBy } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const result = await reversalService.getReversalsByUser(requestedBy, limit);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to get user reversals", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get user reversals",
    });
  }
});

/**
 * GET /api/v1/reversals/stats/:requestedBy
 *
 * Get reversal statistics for a user.
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalStats
 * }
 */
router.get("/stats/:requestedBy", async (req: Request, res: Response) => {
  try {
    const { requestedBy } = req.params;

    const result = await reversalService.getUserReversalStats(requestedBy);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to get reversal stats", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get reversal stats",
    });
  }
});

/**
 * GET /api/v1/reversals/limits
 *
 * Get configured reversal limits.
 *
 * Response:
 * {
 *   success: true,
 *   data: ReversalLimits
 * }
 */
router.get("/limits", async (_req: Request, res: Response) => {
  try {
    const result = reversalService.getReversalLimits();

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to get reversal limits", error);
    res.status(500).json({
      success: false,
      error: "Failed to get reversal limits",
    });
  }
});

export default router;