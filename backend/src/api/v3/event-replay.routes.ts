import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import validateRequest from "../../middleware/validateRequest.js";
import { EventReplayService } from "../../services/event-replay.service.js";

const router = Router();
const svc = new EventReplayService();

// ── Validation schemas ────────────────────────────────────────────────────────

const streamIdParamSchema = z.object({
  streamId: z.string().cuid(),
});

const eventsQuerySchema = z.object({
  eventTypes: z.string().optional(), // comma-separated, e.g. "WITHDRAW,PAUSE"
  fromEventId: z.string().min(1).optional(),
  toEventId: z.string().min(1).optional(),
});

const createCheckpointSchema = z.object({
  eventId: z.string().min(1),
  label: z.string().max(128).optional(),
});

const replayRequestSchema = z.object({
  fromCheckpointId: z.string().cuid().optional(),
  fromEventId: z.string().min(1).optional(),
  toEventId: z.string().min(1).optional(),
  eventTypes: z.array(z.string().min(1)).optional(),
});

function parseEventTypes(csv?: string): string[] | undefined {
  if (!csv) return undefined;
  const types = csv.split(",").map((t) => t.trim()).filter(Boolean);
  return types.length > 0 ? types : undefined;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/streams/:streamId/events
 * Filterable view of a stream's stored event log.
 */
router.get(
  "/streams/:streamId/events",
  validateRequest({ params: streamIdParamSchema, query: eventsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { eventTypes, fromEventId, toEventId } = req.query as z.infer<typeof eventsQuerySchema>;
    const events = await svc.getEvents(req.params.streamId, {
      eventTypes: parseEventTypes(eventTypes),
      fromEventId,
      toEventId,
    });
    res.json({ success: true, data: events });
  }),
);

/**
 * POST /api/v3/streams/:streamId/replay-checkpoints
 * Bookmark an event on a stream's log to replay from later.
 */
router.post(
  "/streams/:streamId/replay-checkpoints",
  validateRequest({ params: streamIdParamSchema, body: createCheckpointSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, label } = req.body as z.infer<typeof createCheckpointSchema>;
    const checkpoint = await svc.createCheckpoint(req.params.streamId, eventId, label);
    res.status(201).json({ success: true, data: checkpoint });
  }),
);

/**
 * GET /api/v3/streams/:streamId/replay-checkpoints
 * List saved checkpoints for a stream.
 */
router.get(
  "/streams/:streamId/replay-checkpoints",
  validateRequest({ params: streamIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const checkpoints = await svc.listCheckpoints(req.params.streamId);
    res.json({ success: true, data: checkpoints });
  }),
);

/**
 * POST /api/v3/streams/:streamId/replay
 * Reconstruct state by replaying the event log, optionally resuming after a
 * checkpoint and/or narrowed to an event-id range or set of event types.
 */
router.post(
  "/streams/:streamId/replay",
  validateRequest({ params: streamIdParamSchema, body: replayRequestSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const options = req.body as z.infer<typeof replayRequestSchema>;
    const result = await svc.replayStream(req.params.streamId, options);
    res.json({ success: true, data: result });
  }),
);

/**
 * GET /api/v3/streams/:streamId/replay/verify
 * Replay a stream from genesis and compare the reconstructed state against
 * its live row — used to confirm replay correctness after recovery/debugging.
 */
router.get(
  "/streams/:streamId/replay/verify",
  validateRequest({ params: streamIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await svc.verifyReplayAgainstLive(req.params.streamId);
    res.json({ success: true, data: result });
  }),
);

/**
 * GET /api/v3/streams/:streamId/replay-runs
 * Audit trail of past replay/verification runs for a stream.
 */
router.get(
  "/streams/:streamId/replay-runs",
  validateRequest({ params: streamIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const runs = await svc.listRuns(req.params.streamId);
    res.json({ success: true, data: runs });
  }),
);

export default router;
