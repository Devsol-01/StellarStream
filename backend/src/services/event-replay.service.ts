import { prisma } from "../lib/db.js";
import type { Prisma } from "../generated/client/index.js";
import { EventSourceService, type EventChainEntry } from "./event-source.service.js";
import { NotFoundError, ValidationError } from "../lib/app-error.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReplayState {
  streamId: string;
  status: string;
  withdrawn: string;
  lastEventId: string | null;
  lastEventType: string | null;
  eventCount: number;
}

export interface EventFilter {
  eventTypes?: string[];
  fromEventId?: string;
  toEventId?: string;
}

export interface StateDifference {
  field: string;
  reconstructed: string;
  live: string;
}

export interface ReplayOptions extends EventFilter {
  fromCheckpointId?: string;
}

const KNOWN_EVENT_TYPES = ["CREATE", "WITHDRAW", "PAUSE", "RESUME", "CANCEL"] as const;

// ── Pure helpers (no DB) ──────────────────────────────────────────────────────

/**
 * Fold a single event into the running reconstructed state. Pure so the
 * reducer rules are unit-testable in isolation from storage.
 *
 * `state` is null only at genesis (no checkpoint supplied); in that case the
 * first event applied must be CREATE. Unrecognized event types leave
 * status/withdrawn untouched but still advance the cursor, so replays stay
 * forward-compatible with event types introduced after they were recorded.
 */
export function applyEventToState(
  state: ReplayState | null,
  event: EventChainEntry,
): ReplayState {
  if (state === null) {
    if (event.eventType !== "CREATE") {
      throw new ValidationError(
        `Cannot reconstruct state: first event must be CREATE, got ${event.eventType}`,
      );
    }
    return {
      streamId: event.streamId,
      status: "ACTIVE",
      withdrawn: "0",
      lastEventId: event.eventId,
      lastEventType: event.eventType,
      eventCount: 1,
    };
  }

  const next: ReplayState = {
    ...state,
    lastEventId: event.eventId,
    lastEventType: event.eventType,
    eventCount: state.eventCount + 1,
  };

  switch (event.eventType) {
    case "WITHDRAW": {
      const amount = BigInt(String(event.payload.amount ?? "0"));
      next.withdrawn = (BigInt(state.withdrawn) + amount).toString();
      break;
    }
    case "PAUSE":
      next.status = "PAUSED";
      break;
    case "RESUME":
      next.status = "ACTIVE";
      break;
    case "CANCEL":
      next.status = "CANCELED";
      break;
    default:
      // Unknown/forward-compatible event type: cursor already advanced above.
      break;
  }

  return next;
}

/** Fold an ordered list of events into a final state. Pure (no DB). */
export function reconstructState(
  events: EventChainEntry[],
  initialState: ReplayState | null = null,
): ReplayState | null {
  return events.reduce<ReplayState | null>(
    (state, event) => applyEventToState(state, event),
    initialState,
  );
}

/** Narrow an ordered event list down to a filter's event types / id range. Pure. */
export function filterEvents(
  events: EventChainEntry[],
  filter: EventFilter = {},
): EventChainEntry[] {
  let from = 0;
  let to = events.length;

  if (filter.fromEventId) {
    const idx = events.findIndex((e) => e.eventId === filter.fromEventId);
    if (idx === -1) {
      throw new NotFoundError("Event not found for fromEventId");
    }
    from = idx + 1; // fromEventId is exclusive — it's the checkpoint baseline
  }

  if (filter.toEventId) {
    const idx = events.findIndex((e) => e.eventId === filter.toEventId);
    if (idx === -1) {
      throw new NotFoundError("Event not found for toEventId");
    }
    to = idx + 1; // toEventId is inclusive
  }

  const sliced = events.slice(from, to);
  if (!filter.eventTypes || filter.eventTypes.length === 0) return sliced;

  const allowed = new Set(filter.eventTypes);
  return sliced.filter((e) => allowed.has(e.eventType));
}

/** Compare a reconstructed state against the live Stream row. Pure (no DB). */
export function diffState(
  reconstructed: ReplayState,
  live: { status: string; withdrawn: string | null },
): StateDifference[] {
  const differences: StateDifference[] = [];

  if (reconstructed.status !== live.status) {
    differences.push({
      field: "status",
      reconstructed: reconstructed.status,
      live: live.status,
    });
  }

  const liveWithdrawn = live.withdrawn ?? "0";
  if (BigInt(reconstructed.withdrawn) !== BigInt(liveWithdrawn)) {
    differences.push({
      field: "withdrawn",
      reconstructed: reconstructed.withdrawn,
      live: liveWithdrawn,
    });
  }

  return differences;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class EventReplayService {
  private eventSource = new EventSourceService();

  // ── Event filtering ──────────────────────────────────────────────────────

  /** List a stream's events, optionally filtered by type or id range. */
  async getEvents(streamId: string, filter: EventFilter = {}): Promise<EventChainEntry[]> {
    const events = await this.eventSource.getStreamEvents(streamId);
    return filterEvents(events, filter);
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────

  async createCheckpoint(streamId: string, eventId: string, label?: string) {
    const events = await this.eventSource.getStreamEvents(streamId);
    const exists = events.some((e) => e.eventId === eventId);
    if (!exists) {
      throw new NotFoundError(`Event ${eventId} not found on stream ${streamId}`);
    }

    return prisma.replayCheckpoint.create({
      data: { streamId, eventId, label },
    });
  }

  async listCheckpoints(streamId: string) {
    return prisma.replayCheckpoint.findMany({
      where: { streamId },
      orderBy: { createdAt: "asc" },
    });
  }

  // ── Replay ───────────────────────────────────────────────────────────────

  /**
   * Reconstruct a stream's state by replaying its event log, optionally
   * resuming after a checkpoint and/or narrowing to an event-id range or
   * set of event types. Persists a ReplayRun audit record.
   */
  async replayStream(streamId: string, options: ReplayOptions = {}) {
    const startedAt = Date.now();
    const events = await this.eventSource.getStreamEvents(streamId);
    if (events.length === 0) {
      throw new NotFoundError(`No events found for stream ${streamId}`);
    }

    let fromEventId = options.fromEventId;
    if (options.fromCheckpointId) {
      const checkpoint = await prisma.replayCheckpoint.findUnique({
        where: { id: options.fromCheckpointId },
      });
      if (!checkpoint || checkpoint.streamId !== streamId) {
        throw new NotFoundError("Checkpoint not found for this stream");
      }
      fromEventId = checkpoint.eventId;
    }

    // Baseline: state as of (and including) the checkpoint, so replay can
    // resume from there without re-deriving business rules for genesis.
    const initialState = fromEventId
      ? reconstructState(filterEvents(events, { toEventId: fromEventId }))
      : null;

    const applied = filterEvents(events, {
      fromEventId,
      toEventId: options.toEventId,
      eventTypes: options.eventTypes,
    });

    const finalState = reconstructState(applied, initialState);
    const durationMs = Date.now() - startedAt;

    const run = await prisma.replayRun.create({
      data: {
        streamId,
        fromEventId: fromEventId ?? null,
        toEventId: applied.length > 0 ? applied[applied.length - 1].eventId : null,
        eventCount: applied.length,
        reconstructedStatus: finalState?.status ?? null,
        reconstructedWithdrawn: finalState?.withdrawn ?? null,
        durationMs,
      },
    });

    return { state: finalState, run };
  }

  /**
   * Replay a stream from genesis and compare the reconstructed state against
   * its live Stream row. Persists a ReplayRun with the comparison result.
   */
  async verifyReplayAgainstLive(streamId: string) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { status: true, withdrawn: true },
    });
    if (!stream) throw new NotFoundError("Stream not found");

    const startedAt = Date.now();
    const events = await this.eventSource.getStreamEvents(streamId);
    if (events.length === 0) {
      throw new NotFoundError(`No events found for stream ${streamId}`);
    }

    const finalState = reconstructState(events);
    const durationMs = Date.now() - startedAt;
    const differences = finalState ? diffState(finalState, stream) : [];

    const run = await prisma.replayRun.create({
      data: {
        streamId,
        fromEventId: null,
        toEventId: events[events.length - 1].eventId,
        eventCount: events.length,
        reconstructedStatus: finalState?.status ?? null,
        reconstructedWithdrawn: finalState?.withdrawn ?? null,
        matchesLive: differences.length === 0,
        differences: differences as unknown as Prisma.InputJsonValue,
        durationMs,
      },
    });

    return { state: finalState, matchesLive: differences.length === 0, differences, run };
  }

  async listRuns(streamId: string) {
    return prisma.replayRun.findMany({
      where: { streamId },
      orderBy: { createdAt: "desc" },
    });
  }
}

export { KNOWN_EVENT_TYPES };
