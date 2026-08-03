/**
 * Snapshot API Routes
 * Endpoints for managing stream snapshots and archives
 */

import { Router, Request, Response } from "express";
import { SnapshotService } from "../services/snapshot.service.js";
import { runMaintenanceNow, runHourlySnapshotsNow } from "../services/snapshot.scheduler.js";
import { logger } from "../logger.js";

const router = Router();
const snapshotService = new SnapshotService();

/**
 * POST /api/v1/snapshots/hourly
 * Manually trigger hourly snapshot creation
 */
router.post("/hourly", async (_req: Request, res: Response) => {
  try {
    const result = await runHourlySnapshotsNow();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Manual hourly snapshot trigger failed", error);
    res.status(500).json({
      success: false,
      error: "Failed to create hourly snapshots",
    });
  }
});

/**
 * POST /api/v1/snapshots/maintenance
 * Manually trigger monthly snapshot maintenance
 */
router.post("/maintenance", async (_req: Request, res: Response) => {
  try {
    const result = await runMaintenanceNow();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Manual maintenance trigger failed", error);
    res.status(500).json({
      success: false,
      error: "Failed to run maintenance",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId
 * Get all snapshots for a stream
 */
router.get("/:streamId", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const { from, to } = req.query;

    const snapshots = await snapshotService.getHourlySnapshots(
      streamId,
      from ? new Date(from as string) : undefined,
      to ? new Date(to as string) : undefined,
    );

    res.json({
      success: true,
      data: snapshots,
    });
  } catch (error) {
    logger.error("Failed to fetch snapshots", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch snapshots",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/point-in-time
 * Get stream state at a specific point in time
 */
router.get("/:streamId/point-in-time", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const { timestamp } = req.query;

    if (!timestamp) {
      return res.status(400).json({
        success: false,
        error: "timestamp query parameter required (ISO 8601 format)",
      });
    }

    const snapshot = await snapshotService.getSnapshotAtTime(
      streamId,
      new Date(timestamp as string),
    );

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: "No snapshot found for the specified time",
      });
    }

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error("Failed to fetch point-in-time snapshot", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch point-in-time snapshot",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/compare
 * Compare stream state between two points in time
 */
router.get("/:streamId/compare", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const { timeA, timeB } = req.query;

    if (!timeA || !timeB) {
      return res.status(400).json({
        success: false,
        error: "Both timeA and timeB query parameters required (ISO 8601 format)",
      });
    }

    const result = await snapshotService.compareSnapshots(
      streamId,
      new Date(timeA as string),
      new Date(timeB as string),
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Failed to compare snapshots", error);
    res.status(500).json({
      success: false,
      error: "Failed to compare snapshots",
    });
  }
});

/**
 * POST /api/v1/snapshots/:streamId/restore
 * Restore stream state from a specific point in time
 */
router.post("/:streamId/restore", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const { timestamp } = req.body;

    if (!timestamp) {
      return res.status(400).json({
        success: false,
        error: "timestamp body parameter required (ISO 8601 format)",
      });
    }

    const restored = await snapshotService.restoreFromSnapshot(
      streamId,
      new Date(timestamp),
    );

    if (!restored) {
      return res.status(404).json({
        success: false,
        error: "No snapshot found for restore",
      });
    }

    res.json({
      success: true,
      message: "Stream state restored successfully",
    });
  } catch (error) {
    logger.error("Failed to restore snapshot", error);
    res.status(500).json({
      success: false,
      error: "Failed to restore snapshot",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/:month
 * Get monthly snapshot for a specific stream and month
 */
router.get("/:streamId/:month", async (req: Request, res: Response): Promise<void> => {
  try {
    const { streamId, month } = req.params;
    const snapshot = await snapshotService.getSnapshot(streamId, month);

    if (!snapshot) {
      res.status(404).json({
        success: false,
        error: "Snapshot not found",
      });
      return;
    }

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error("Failed to fetch snapshot", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch snapshot",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/archive
 * Get archived logs for a stream
 */
router.get("/:streamId/archive", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const archives = await snapshotService.getArchivedLogs(streamId);

    res.json({
      success: true,
      data: archives,
    });
  } catch (error) {
    logger.error("Failed to fetch archived logs", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch archived logs",
    });
  }
});

export default router;