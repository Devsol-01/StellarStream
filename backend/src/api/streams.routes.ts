import { Router, Request, Response } from "express";
import { StreamService } from "../services/stream.service";
import { logger } from "../logger";

const router = Router();
const streamService = new StreamService();

/**
 * GET /api/v1/streams/:address
 * Returns streams for a given address with optional filtering
 * Query params:
 *   - direction: inbound | outbound (optional)
 *   - status: active | paused | completed (optional)
 *   - tokens: comma-separated token addresses (optional)
 */
router.get("/streams/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { direction, status, tokens } = req.query;

    if (!address) {
      res.status(400).json({
        success: false,
        error: "Address is required",
      });
      return;
    }

    const filters: any = {};

    if (direction && (direction === "inbound" || direction === "outbound")) {
      filters.direction = direction;
    }

    if (status && ["active", "paused", "completed"].includes(status as string)) {
      filters.status = status;
    }

    if (tokens && typeof tokens === "string") {
      filters.tokenAddresses = tokens.split(",").map((t) => t.trim());
    }

    const streams = await streamService.getStreamsForAddress(address, filters);

    res.json({
      success: true,
      address,
      count: streams.length,
      filters,
      streams,
    });
  } catch (error) {
    logger.error("Failed to retrieve streams", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve streams",
    });
  }
});

export default router;
