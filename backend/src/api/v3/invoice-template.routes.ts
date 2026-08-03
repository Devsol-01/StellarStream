import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import stellarAddressSchema from "../../validation/stellar.js";
import { InvoiceTemplateService } from "../../services/invoice-template.service.js";

const router = Router();
const svc = new InvoiceTemplateService();

// ── Validation schemas ────────────────────────────────────────────────────────

const languageSchema = z.enum(["en", "ar", "fr", "es"]);

const createTemplateSchema = z.object({
  ownerAddress: stellarAddressSchema,
  name: z.string().min(1).max(128),
  language: languageSchema.optional(),
  isDefault: z.boolean().optional(),
  accentColor: z.string().optional(),
  logoBase64: z.string().optional(),
  footerText: z.string().max(256).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  language: languageSchema.optional(),
  isDefault: z.boolean().optional(),
  accentColor: z.string().optional(),
  logoBase64: z.string().optional(),
  footerText: z.string().max(256).optional(),
});

const listQuerySchema = z.object({
  ownerAddress: stellarAddressSchema,
});

const templateIdParamSchema = z.object({
  id: z.string().cuid(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/invoice-templates?ownerAddress=
 * List all invoice templates for an owner.
 */
router.get(
  "/invoice-templates",
  validateRequest({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerAddress } = req.query as unknown as z.infer<typeof listQuerySchema>;
    const templates = await svc.listTemplates(ownerAddress);
    res.json({ success: true, data: templates });
  }),
);

/**
 * POST /api/v3/invoice-templates
 * Create a new reusable invoice template.
 */
router.post(
  "/invoice-templates",
  validateRequest({ body: createTemplateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const template = await svc.createTemplate(req.body);
    res.status(201).json({ success: true, data: template });
  }),
);

/**
 * GET /api/v3/invoice-templates/:id
 */
router.get(
  "/invoice-templates/:id",
  validateRequest({ params: templateIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const template = await svc.getTemplate(req.params.id);
    res.json({ success: true, data: template });
  }),
);

/**
 * PUT /api/v3/invoice-templates/:id
 */
router.put(
  "/invoice-templates/:id",
  validateRequest({ params: templateIdParamSchema, body: updateTemplateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const template = await svc.updateTemplate(req.params.id, req.body);
    res.json({ success: true, data: template });
  }),
);

/**
 * DELETE /api/v3/invoice-templates/:id
 */
router.delete(
  "/invoice-templates/:id",
  validateRequest({ params: templateIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const template = await svc.deleteTemplate(req.params.id);
    res.json({ success: true, data: { deleted: true, id: template.id } });
  }),
);

export default router;
