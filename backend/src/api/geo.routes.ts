/**
 * Geolocation API Routes — /api/v1/geo
 */

import { Router, Request, Response } from "express";
import { geolocationService } from "../services/geolocation.service.js";
import { logger } from "../logger.js";
import { z } from "zod";

const router = Router();

// Validation schema for geo restriction upsert
const GeoRestrictionSchema = z.object({
  body: z.object({
    region: z.string().min(1).max(10),
    action: z.enum(["block", "allow"]),
  }),
});

/**
 * GET /api/v1/geo/detect
 * Detect geolocation for the current request IP
 */
router.get("/detect", async (req: Request, res: Response): Promise<void> => {
  try {
    const ip = req.headers["x-forwarded-for"] as string ||
               req.headers["x-real-ip"] as string ||
               req.socket.remoteAddress || "unknown";

    const geo = await geolocationService.lookupIP(ip);

    if (geo) {
      res.json({
        success: true,
        data: {
          countryCode: geo.countryCode,
          region: geo.region,
          city: geo.city,
          timezone: geo.timezone || geolocationService.getTimezone(geo.countryCode),
          // Note: coordinates not returned for privacy
        },
      });
      return;
    }

    res.json({
      success: true,
      data: null,
    });
  } catch (err) {
    logger.error("[geo/detect] Error", { err });
    res.status(500).json({
      success: false,
      error: "Failed to detect location",
    });
  }
});

/**
 * GET /api/v1/geo/analytics
 * Get geographic analytics summary (admin only - caller must be authenticated)
 */
router.get("/analytics", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.address;
    const summary = await geolocationService.getAnalyticsSummary(userId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    logger.error("[geo/analytics] Error", { err });
    res.status(500).json({
      success: false,
      error: "Failed to fetch analytics",
    });
  }
});

/**
 * GET /api/v1/geo/rules
 * Get geographic restriction rules for authenticated user
 */
router.get("/rules", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.address;
    if (!userId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const rules = await geolocationService.getRules(userId);
    res.json({
      success: true,
      rules,
    });
  } catch (err) {
    logger.error("[geo/rules] Error", { err });
    res.status(500).json({
      success: false,
      error: "Failed to fetch rules",
    });
  }
});

/**
 * POST /api/v1/geo/rules
 * Create/update a geographic restriction rule
 */
router.post(
  "/rules",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.address;
      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { region, action } = req.body as {
        region: string;
        action: "block" | "allow";
      };

      if (!region || !action) {
        res.status(400).json({
          success: false,
          error: "region and action are required",
        });
        return;
      }

      const rule = await geolocationService.upsertRule(userId, region, action);
      res.json({
        success: true,
        rule,
      });
    } catch (err) {
      logger.error("[geo/rules] Error", { err });
      res.status(500).json({
        success: false,
        error: "Failed to upsert rule",
      });
    }
  },
);

/**
 * DELETE /api/v1/geo/rules/:region
 * Delete a geographic restriction rule
 */
router.delete(
  "/rules/:region",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.address;
      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { region } = req.params;
      await geolocationService.deleteRule(userId, region);

      res.json({
        success: true,
        message: "Rule deleted",
      });
    } catch (err) {
      logger.error("[geo/rules] Error", { err });
      res.status(500).json({
        success: false,
        error: "Failed to delete rule",
      });
    }
  },
);

export default router;