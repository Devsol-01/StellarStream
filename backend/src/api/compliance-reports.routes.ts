/**
 * Compliance Reports API routes — /api/v1/compliance/reports (#1359)
 *
 * POST   /generate      — generate a regulatory report for a period (admin)
 * GET    /              — list previously generated reports (admin)
 * GET    /:id           — report metadata (admin)
 * GET    /:id/download  — stream the stored report file (admin)
 *
 * All endpoints are admin-gated: these reports can contain KYC levels,
 * sanctions/PEP flags, and full transaction detail for real counterparties.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { complianceReportService } from "../services/compliance-report.service.js";
import validateRequest from "../middleware/validateRequest.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { logger } from "../logger.js";

const router = Router();

// ── Validation schemas ─────────────────────────────────────────────────────

const reportTypeEnum = z.enum([
  "AML_KYC",
  "TRANSACTION_MONITORING",
  "SUSPICIOUS_ACTIVITY",
  "REGULATORY_FILING",
  "AUDIT_TRAIL",
]);

const GenerateSchema = z.object({
  body: z.object({
    reportType: reportTypeEnum,
    format: z.enum(["pdf", "csv"]).default("pdf"),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  }),
});

const ListQuerySchema = z.object({
  query: z.object({
    reportType: reportTypeEnum.optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

const IdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/compliance/reports/generate
 * Generates a regulatory report for [periodStart, periodEnd] and stores it securely.
 * Returns metadata only — the file itself is retrieved via the download endpoint.
 */
router.post(
  "/generate",
  requireAdmin,
  validateRequest({ body: GenerateSchema.shape.body }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { reportType, format, periodStart, periodEnd } =
        req.body as z.infer<typeof GenerateSchema.shape.body>;

      const start = new Date(periodStart);
      const end = new Date(periodEnd);

      if (start > end) {
        res.status(400).json({
          success: false,
          error: "periodStart must be before periodEnd",
          code: "INVALID_PERIOD",
        });
        return;
      }

      const generatedBy =
        (req.headers["x-admin-key"] as string | undefined)?.slice(0, 8) ?? "admin";

      const report = await complianceReportService.generateReport({
        reportType,
        format,
        periodStart: start,
        periodEnd: end,
        generatedBy,
      });

      res.status(201).json({ success: true, report });
    } catch (err) {
      logger.error("[compliance/reports/generate] Error", { err });
      res.status(500).json({ success: false, error: "Failed to generate report" });
    }
  },
);

/**
 * GET /api/v1/compliance/reports
 * List previously generated reports.
 */
router.get(
  "/",
  requireAdmin,
  validateRequest({ query: ListQuerySchema.shape.query }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { reportType, startDate, endDate, limit, offset } =
        req.query as unknown as z.infer<typeof ListQuerySchema.shape.query>;

      const reports = await complianceReportService.listReports({
        reportType,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit,
        offset,
      });

      res.json({ success: true, count: (reports as unknown[]).length, reports });
    } catch (err) {
      logger.error("[compliance/reports] Error", { err });
      res.status(500).json({ success: false, error: "Failed to list reports" });
    }
  },
);

/**
 * GET /api/v1/compliance/reports/:id
 * Report metadata (no file content).
 */
router.get(
  "/:id",
  requireAdmin,
  validateRequest({ params: IdParamSchema.shape.params }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const meta = await complianceReportService.getReportMetadata(req.params.id);
      if (!meta) {
        res.status(404).json({ success: false, error: "Report not found", code: "NOT_FOUND" });
        return;
      }
      // file_path is an internal storage detail — never expose it.
      const { file_path: _filePath, ...safeMeta } = meta;
      res.json({ success: true, report: safeMeta });
    } catch (err) {
      logger.error("[compliance/reports/:id] Error", { err });
      res.status(500).json({ success: false, error: "Failed to fetch report" });
    }
  },
);

/**
 * GET /api/v1/compliance/reports/:id/download
 * Streams the stored report file after verifying its checksum.
 */
router.get(
  "/:id/download",
  requireAdmin,
  validateRequest({ params: IdParamSchema.shape.params }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = await complianceReportService.getReportFile(req.params.id);
      if (!file) {
        res.status(404).json({ success: false, error: "Report not found", code: "NOT_FOUND" });
        return;
      }

      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.setHeader("Content-Length", file.buffer.length);
      res.send(file.buffer);
    } catch (err) {
      logger.error("[compliance/reports/:id/download] Error", { err });
      res.status(500).json({
        success: false,
        error: "Failed to download report — integrity check failed",
        code: "REPORT_INTEGRITY_FAILED",
      });
    }
  },
);

export default router;
