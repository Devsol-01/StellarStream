import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import stellarAddressSchema from "../../validation/stellar.js";
import { PaymentRoutingService } from "../../services/payment-routing.service.js";

const router = Router();
const svc = new PaymentRoutingService();

// ── Validation schemas ────────────────────────────────────────────────────────

const ownerQuerySchema = z.object({
  ownerAddress: stellarAddressSchema,
});

const conditionSchema = z.object({
  type: z.enum(["amount", "asset", "geography", "time"]),
  operator: z.enum(["gte", "lte", "between", "equals", "in"]),
  value: z.string().min(1).max(256),
  value2: z.string().min(1).max(256).optional(),
});

const createRuleSchema = z.object({
  ownerAddress: stellarAddressSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  route: z.string().min(1).max(128),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  conditions: z.array(conditionSchema).min(1).max(20),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(256).optional(),
  route: z.string().min(1).max(128).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  conditions: z.array(conditionSchema).min(1).max(20).optional(),
});

const routingContextSchema = z.object({
  ownerAddress: stellarAddressSchema,
  amount: z.string().regex(/^\d+$/, "Amount must be a non-negative integer string (stroops)"),
  tokenAddress: z.string().min(1).max(256),
  region: z.string().max(64).optional(),
  timestamp: z.string().datetime().optional(),
});

function toContext(body: z.infer<typeof routingContextSchema>) {
  return {
    amount: body.amount,
    tokenAddress: body.tokenAddress,
    region: body.region,
    timestamp: body.timestamp ? new Date(body.timestamp) : undefined,
  };
}

// ── Rule CRUD ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/routing-rules
 * List all routing rules for an owner address, priority order.
 */
router.get(
  "/routing-rules",
  validateRequest({ query: ownerQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerAddress } = req.query as { ownerAddress: string };
    const rules = await svc.getRules(ownerAddress);
    res.json({ success: true, data: rules });
  }),
);

/**
 * POST /api/v3/routing-rules
 * Create a new payment routing rule with its conditions.
 */
router.post(
  "/routing-rules",
  validateRequest({ body: createRuleSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const rule = await svc.createRule(req.body);
    res.status(201).json({ success: true, data: rule });
  }),
);

/**
 * GET /api/v3/routing-rules/:id
 * Get a single routing rule (must belong to ownerAddress).
 */
router.get(
  "/routing-rules/:id",
  validateRequest({ query: ownerQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerAddress } = req.query as { ownerAddress: string };
    const rule = await svc.getRule(req.params.id, ownerAddress);
    res.json({ success: true, data: rule });
  }),
);

/**
 * PATCH /api/v3/routing-rules/:id
 * Update a routing rule's metadata and/or conditions.
 */
router.patch(
  "/routing-rules/:id",
  validateRequest({ body: updateRuleSchema, query: ownerQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerAddress } = req.query as { ownerAddress: string };
    const rule = await svc.updateRule(req.params.id, ownerAddress, req.body);
    res.json({ success: true, data: rule });
  }),
);

/**
 * DELETE /api/v3/routing-rules/:id
 * Delete a routing rule.
 */
router.delete(
  "/routing-rules/:id",
  validateRequest({ query: ownerQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerAddress } = req.query as { ownerAddress: string };
    await svc.deleteRule(req.params.id, ownerAddress);
    res.json({ success: true, message: "Routing rule deleted" });
  }),
);

// ── Rule engine ───────────────────────────────────────────────────────────────

/**
 * POST /api/v3/routing-rules/evaluate
 * Evaluate a payment context against all active rules for an owner and
 * return the first matching rule's route (highest priority first).
 */
router.post(
  "/routing-rules/evaluate",
  validateRequest({ body: routingContextSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof routingContextSchema>;
    const result = await svc.evaluate(body.ownerAddress, toContext(body));
    res.json({ success: true, data: result });
  }),
);

/**
 * POST /api/v3/routing-rules/:id/test
 * Dry-run a single rule (active or inactive) against a payment context,
 * without applying it. Used to validate a rule before activating it.
 */
router.post(
  "/routing-rules/:id/test",
  validateRequest({ body: routingContextSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof routingContextSchema>;
    const result = await svc.testRule(req.params.id, body.ownerAddress, toContext(body));
    res.json({ success: true, data: result });
  }),
);

export default router;
