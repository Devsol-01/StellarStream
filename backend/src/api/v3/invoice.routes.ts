import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import stellarAddressSchema from "../../validation/stellar.js";
import {
  InvoiceService,
  INVOICE_STATUSES,
  type InvoiceStatusValue,
} from "../../services/invoice.service.js";

const router = Router();
const svc = new InvoiceService();

// ── Validation schemas ────────────────────────────────────────────────────────

const amountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal string");
const statusSchema = z.enum(INVOICE_STATUSES);

const recipientSchema = z.object({
  address: z.string().min(1),
  amount: amountSchema,
  label: z.string().optional(),
});

const createInvoiceSchema = z.object({
  ownerAddress: stellarAddressSchema,
  sender: z.string().min(1),
  asset: z.string().min(1),
  recipients: z.array(recipientSchema).min(1),
  taxRate: z.number().min(0).max(100).optional(),
  language: z.enum(["en", "ar", "fr", "es"]).optional(),
  templateId: z.string().cuid().optional(),
  disbursementId: z.string().cuid().optional(),
  note: z.string().max(512).optional(),
  txHash: z.string().max(128).optional(),
  dueAt: z.string().datetime().optional(),
});

const listQuerySchema = z.object({
  ownerAddress: stellarAddressSchema,
  status: statusSchema.optional(),
});

const invoiceIdParamSchema = z.object({
  id: z.string().cuid(),
});

const updateStatusSchema = z.object({
  status: statusSchema,
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v3/invoices
 * Create a DRAFT invoice: computes subtotal/tax/total, allocates a
 * sequential invoice number, and resolves the owner's template (explicit
 * templateId, else their default template if any).
 */
router.post(
  "/invoices",
  validateRequest({ body: createInvoiceSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await svc.createInvoice(req.body);
    res.status(201).json({ success: true, data: invoice });
  }),
);

/**
 * GET /api/v3/invoices?ownerAddress=&status=
 * List invoices for an owner, optionally filtered by status.
 */
router.get(
  "/invoices",
  validateRequest({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const filter = req.query as unknown as z.infer<typeof listQuerySchema>;
    const invoices = await svc.listInvoices(filter);
    res.json({ success: true, data: invoices });
  }),
);

/**
 * GET /api/v3/invoices/:id
 */
router.get(
  "/invoices/:id",
  validateRequest({ params: invoiceIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await svc.getInvoice(req.params.id);
    res.json({ success: true, data: invoice });
  }),
);

/**
 * PATCH /api/v3/invoices/:id/status
 * Transition an invoice through DRAFT -> ISSUED -> PAID, or to VOID.
 */
router.patch(
  "/invoices/:id/status",
  validateRequest({ params: invoiceIdParamSchema, body: updateStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    const invoice = await svc.updateInvoiceStatus(req.params.id, status as InvoiceStatusValue);
    res.json({ success: true, data: invoice });
  }),
);

/**
 * GET /api/v3/invoices/:id/pdf
 * Renders and streams the invoice as a professional PDF document.
 */
router.get(
  "/invoices/:id/pdf",
  validateRequest({ params: invoiceIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, invoiceNumber } = await svc.renderInvoicePdf(req.params.id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }),
);

export default router;
