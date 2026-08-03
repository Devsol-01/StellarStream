import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import {
  PaymentStatusService,
  PAYMENT_TRACKING_STATUSES,
  type PaymentTrackingStatus,
} from "../../services/payment-status.service.js";

const router = Router();
const svc = new PaymentStatusService();

// ── Validation schemas ────────────────────────────────────────────────────────

const statusSchema = z.enum(PAYMENT_TRACKING_STATUSES);

const disbursementParamsSchema = z.object({
  disbursementId: z.string().min(1).max(128),
});

const transitionBodySchema = z.object({
  status: statusSchema,
  note: z.string().max(512).optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/disbursements/:disbursementId/status
 * Current payment status (INITIATED if no transitions recorded yet).
 */
router.get(
  "/disbursements/:disbursementId/status",
  validateRequest({ params: disbursementParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { disbursementId } = req.params as unknown as { disbursementId: string };
    const status = await svc.getCurrentStatus(disbursementId);
    res.json({ success: true, data: { disbursementId, status } });
  }),
);

/**
 * GET /api/v3/disbursements/:disbursementId/status/timeline
 * Full ordered status timeline for visualization.
 */
router.get(
  "/disbursements/:disbursementId/status/timeline",
  validateRequest({ params: disbursementParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { disbursementId } = req.params as unknown as { disbursementId: string };
    const timeline = await svc.getTimeline(disbursementId);
    res.json({ success: true, data: timeline });
  }),
);

/**
 * POST /api/v3/disbursements/:disbursementId/status
 * Record a status transition. Fires a `payment_status_<status>` webhook.
 */
router.post(
  "/disbursements/:disbursementId/status",
  validateRequest({ params: disbursementParamsSchema, body: transitionBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { disbursementId } = req.params as unknown as { disbursementId: string };
    const { status, note } = req.body as { status: PaymentTrackingStatus; note?: string };
    const event = await svc.transition(disbursementId, status, note);
    res.status(201).json({ success: true, data: event });
  }),
);

export default router;
