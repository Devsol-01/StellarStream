import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import stellarAddressSchema from "../../validation/stellar.js";
import {
  PaymentAuthorizationService,
  MIN_HOLD_PERIOD_SECS,
  MAX_HOLD_PERIOD_SECS,
} from "../../services/payment-authorization.service.js";

const router = Router();
const svc = new PaymentAuthorizationService();

// ── Validation schemas ────────────────────────────────────────────────────────

const amountSchema = z.string().regex(/^\d+$/, "Amount must be a positive integer string");

const createAuthorizationSchema = z.object({
  payerAddress: stellarAddressSchema,
  payeeAddress: stellarAddressSchema,
  tokenAddress: stellarAddressSchema,
  amount: amountSchema,
  holdPeriodSecs: z.number().int().min(MIN_HOLD_PERIOD_SECS).max(MAX_HOLD_PERIOD_SECS),
});

const listQuerySchema = z.object({
  payerAddress: stellarAddressSchema.optional(),
  payeeAddress: stellarAddressSchema.optional(),
  status: z
    .enum(["AUTHORIZED", "PARTIALLY_CAPTURED", "CAPTURED", "RELEASED", "EXPIRED"])
    .optional(),
});

const authorizationIdParamSchema = z.object({
  id: z.string().cuid(),
});

const captureAuthorizationSchema = z.object({
  amount: amountSchema.optional(),
  txHash: z.string().max(128).optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v3/payment-authorizations
 * Create a new pre-authorization hold.
 */
router.post(
  "/payment-authorizations",
  validateRequest({ body: createAuthorizationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const authorization = await svc.createAuthorization(req.body);
    res.status(201).json({ success: true, data: authorization });
  }),
);

/**
 * GET /api/v3/payment-authorizations
 * List authorizations, optionally filtered by payer, payee, or status.
 */
router.get(
  "/payment-authorizations",
  validateRequest({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const filter = req.query as z.infer<typeof listQuerySchema>;
    const authorizations = await svc.listAuthorizations(filter);
    res.json({ success: true, data: authorizations });
  }),
);

/**
 * GET /api/v3/payment-authorizations/:id
 * Get a single authorization, including its captures.
 */
router.get(
  "/payment-authorizations/:id",
  validateRequest({ params: authorizationIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const authorization = await svc.getAuthorization(req.params.id);
    res.json({ success: true, data: authorization });
  }),
);

/**
 * POST /api/v3/payment-authorizations/:id/capture
 * Capture some or all of the held amount. Omit `amount` to capture the full
 * remaining balance. Rejected once the hold is fully captured, released, or
 * past its hold period (automatically marked EXPIRED).
 */
router.post(
  "/payment-authorizations/:id/capture",
  validateRequest({ params: authorizationIdParamSchema, body: captureAuthorizationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { amount, txHash } = req.body as z.infer<typeof captureAuthorizationSchema>;
    const authorization = await svc.captureAuthorization(req.params.id, amount, txHash);
    res.json({ success: true, data: authorization });
  }),
);

/**
 * POST /api/v3/payment-authorizations/:id/release
 * Release the uncaptured remainder of a hold back to the payer.
 */
router.post(
  "/payment-authorizations/:id/release",
  validateRequest({ params: authorizationIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const authorization = await svc.releaseAuthorization(req.params.id);
    res.json({ success: true, data: authorization });
  }),
);

export default router;
