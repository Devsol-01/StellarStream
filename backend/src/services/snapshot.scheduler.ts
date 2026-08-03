/**
 * Snapshot Scheduler
 * Runs hourly snapshots and monthly archival tasks
 */

import { SnapshotService } from "../services/snapshot.service.js";
import { logger } from "../logger.js";
import cron from "node-cron";

const snapshotService = new SnapshotService();

/**
 * Schedule hourly snapshot creation (at minute 5 of each hour)
 * and monthly archival maintenance (1st of each month at 2 AM)
 */
export function scheduleSnapshotMaintenance() {
  // Hourly snapshots - runs at minute 5 of each hour
  cron.schedule("5 * * * *", async () => {
    try {
      logger.info("Starting hourly snapshot creation");
      const result = await snapshotService.createHourlySnapshots();
      logger.info("Hourly snapshot creation completed", result);
    } catch (error) {
      logger.error("Hourly snapshot creation failed", error);
    }
  });

  // Monthly archival maintenance - runs on 1st of each month at 2 AM
  cron.schedule("0 2 1 * * *", async () => {
    try {
      logger.info("Starting monthly archival maintenance");
      const result = await snapshotService.runMaintenance();
      logger.info("Monthly archival maintenance completed", result);
    } catch (error) {
      logger.error("Monthly archival maintenance failed", error);
    }
  });

  logger.info("Snapshot maintenance scheduler initialized");
}

/**
 * Run maintenance immediately (for manual triggers or testing)
 */
export async function runMaintenanceNow() {
  return snapshotService.runMaintenance();
}

/**
 * Run hourly snapshots immediately (for manual triggers or testing)
 */
export async function runHourlySnapshotsNow() {
  return snapshotService.createHourlySnapshots();
}