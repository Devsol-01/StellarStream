/**
 * Contract State Snapshot Worker
 * Handles periodic hourly snapshots of contract states
 */

import { SnapshotService } from "./services/snapshot.service.js";
import { logger } from "./logger.js";

const snapshotService = new SnapshotService();

/**
 * Run hourly snapshot creation immediately
 */
export async function contractStateSnapshotWorker(): Promise<void> {
  try {
    logger.info("[SnapshotWorker] Starting hourly contract state snapshots");
    const result = await snapshotService.createHourlySnapshots();
    logger.info("[SnapshotWorker] Hourly snapshots completed", {
      count: result.count,
      timestamp: result.timestamp,
    });
  } catch (error) {
    logger.error("[SnapshotWorker] Hourly snapshot creation failed:", error);
    throw error;
  }
}

// Export for PM2 ecosystem or manual invocation
export default contractStateSnapshotWorker;