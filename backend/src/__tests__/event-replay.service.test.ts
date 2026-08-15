import { describe, it, expect } from "vitest";
import {
  applyEventToState,
  reconstructState,
  filterEvents,
  diffState,
  type ReplayState,
} from "../services/event-replay.service.js";
import type { EventChainEntry } from "../services/event-source.service.js";

// ═══════════════════════════════════════════════════════════════
// EventReplayService — pure logic (no DB dependency)
// ═══════════════════════════════════════════════════════════════

function makeEvent(
  eventId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
): EventChainEntry {
  return {
    id: eventId,
    eventId,
    streamId: "stream-1",
    eventType,
    payload,
    timestamp: new Date(),
    hash: `hash-${eventId}`,
    previousHash: null,
  };
}

describe("EventReplayService", () => {
  describe("applyEventToState", () => {
    it("requires the first event at genesis to be CREATE", () => {
      expect(() => applyEventToState(null, makeEvent("e1", "WITHDRAW"))).toThrow(
        /first event must be CREATE/,
      );
    });

    it("initializes state from a CREATE event", () => {
      const state = applyEventToState(null, makeEvent("e1", "CREATE"));
      expect(state).toEqual({
        streamId: "stream-1",
        status: "ACTIVE",
        withdrawn: "0",
        lastEventId: "e1",
        lastEventType: "CREATE",
        eventCount: 1,
      });
    });

    it("accumulates WITHDRAW amounts", () => {
      let state: ReplayState | null = applyEventToState(null, makeEvent("e1", "CREATE"));
      state = applyEventToState(state, makeEvent("e2", "WITHDRAW", { amount: "300" }));
      state = applyEventToState(state, makeEvent("e3", "WITHDRAW", { amount: "150" }));
      expect(state.withdrawn).toBe("450");
      expect(state.eventCount).toBe(3);
    });

    it("applies PAUSE, RESUME, and CANCEL transitions", () => {
      let state: ReplayState | null = applyEventToState(null, makeEvent("e1", "CREATE"));
      state = applyEventToState(state, makeEvent("e2", "PAUSE"));
      expect(state.status).toBe("PAUSED");
      state = applyEventToState(state, makeEvent("e3", "RESUME"));
      expect(state.status).toBe("ACTIVE");
      state = applyEventToState(state, makeEvent("e4", "CANCEL"));
      expect(state.status).toBe("CANCELED");
    });

    it("advances the cursor for unknown event types without changing status/withdrawn", () => {
      const initial = applyEventToState(null, makeEvent("e1", "CREATE"));
      const next = applyEventToState(initial, makeEvent("e2", "FUTURE_EVENT_TYPE"));
      expect(next.status).toBe("ACTIVE");
      expect(next.withdrawn).toBe("0");
      expect(next.lastEventId).toBe("e2");
      expect(next.eventCount).toBe(2);
    });

    it("allows resuming from a non-null baseline state without requiring CREATE", () => {
      const baseline: ReplayState = {
        streamId: "stream-1",
        status: "ACTIVE",
        withdrawn: "1000",
        lastEventId: "e5",
        lastEventType: "WITHDRAW",
        eventCount: 5,
      };
      const next = applyEventToState(baseline, makeEvent("e6", "WITHDRAW", { amount: "50" }));
      expect(next.withdrawn).toBe("1050");
    });
  });

  describe("reconstructState", () => {
    it("folds an ordered event list into a final state", () => {
      const events = [
        makeEvent("e1", "CREATE"),
        makeEvent("e2", "WITHDRAW", { amount: "200" }),
        makeEvent("e3", "PAUSE"),
      ];
      const state = reconstructState(events);
      expect(state).toMatchObject({ status: "PAUSED", withdrawn: "200", eventCount: 3 });
    });

    it("returns the initial state unchanged for an empty event list", () => {
      const baseline: ReplayState = {
        streamId: "stream-1",
        status: "ACTIVE",
        withdrawn: "500",
        lastEventId: "e1",
        lastEventType: "CREATE",
        eventCount: 1,
      };
      expect(reconstructState([], baseline)).toEqual(baseline);
    });

    it("returns null for an empty event list with no initial state", () => {
      expect(reconstructState([])).toBeNull();
    });
  });

  describe("filterEvents", () => {
    const events = [
      makeEvent("e1", "CREATE"),
      makeEvent("e2", "WITHDRAW", { amount: "100" }),
      makeEvent("e3", "PAUSE"),
      makeEvent("e4", "RESUME"),
      makeEvent("e5", "WITHDRAW", { amount: "50" }),
    ];

    it("returns all events when no filter is given", () => {
      expect(filterEvents(events)).toHaveLength(5);
    });

    it("excludes the fromEventId itself (exclusive checkpoint baseline)", () => {
      const result = filterEvents(events, { fromEventId: "e2" });
      expect(result.map((e) => e.eventId)).toEqual(["e3", "e4", "e5"]);
    });

    it("includes the toEventId itself (inclusive upper bound)", () => {
      const result = filterEvents(events, { toEventId: "e3" });
      expect(result.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
    });

    it("combines fromEventId and toEventId into a range", () => {
      const result = filterEvents(events, { fromEventId: "e1", toEventId: "e4" });
      expect(result.map((e) => e.eventId)).toEqual(["e2", "e3", "e4"]);
    });

    it("filters by event type", () => {
      const result = filterEvents(events, { eventTypes: ["WITHDRAW"] });
      expect(result.map((e) => e.eventId)).toEqual(["e2", "e5"]);
    });

    it("throws NotFoundError when fromEventId does not exist", () => {
      expect(() => filterEvents(events, { fromEventId: "missing" })).toThrow(
        /Event not found/,
      );
    });

    it("throws NotFoundError when toEventId does not exist", () => {
      expect(() => filterEvents(events, { toEventId: "missing" })).toThrow(
        /Event not found/,
      );
    });
  });

  describe("diffState", () => {
    const reconstructed: ReplayState = {
      streamId: "stream-1",
      status: "ACTIVE",
      withdrawn: "500",
      lastEventId: "e3",
      lastEventType: "WITHDRAW",
      eventCount: 3,
    };

    it("reports no differences when reconstructed state matches live", () => {
      expect(diffState(reconstructed, { status: "ACTIVE", withdrawn: "500" })).toEqual([]);
    });

    it("reports a status difference", () => {
      const diffs = diffState(reconstructed, { status: "PAUSED", withdrawn: "500" });
      expect(diffs).toEqual([{ field: "status", reconstructed: "ACTIVE", live: "PAUSED" }]);
    });

    it("reports a withdrawn difference", () => {
      const diffs = diffState(reconstructed, { status: "ACTIVE", withdrawn: "400" });
      expect(diffs).toEqual([{ field: "withdrawn", reconstructed: "500", live: "400" }]);
    });

    it("treats a null live withdrawn as zero", () => {
      const diffs = diffState(
        { ...reconstructed, withdrawn: "0" },
        { status: "ACTIVE", withdrawn: null },
      );
      expect(diffs).toEqual([]);
    });

    it("reports both fields when both differ", () => {
      const diffs = diffState(reconstructed, { status: "CANCELED", withdrawn: "999" });
      expect(diffs).toHaveLength(2);
    });
  });
});
