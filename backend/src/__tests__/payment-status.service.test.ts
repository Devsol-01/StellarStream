import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaymentStatusService,
  ALLOWED_TRANSITIONS,
  PAYMENT_TRACKING_STATUSES,
  isValidTransition,
  type PaymentTrackingStatus,
} from "../services/payment-status.service.js";
import { prisma } from "../lib/db.js";
import { NotFoundError, BusinessRuleError } from "../lib/app-error.js";

vi.mock("../lib/db.js", () => ({
  prisma: {
    disbursement: {
      findUnique: vi.fn(),
    },
    paymentStatusEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/webhook-dispatcher.service.js", () => ({
  WebhookDispatcherService: class {
    dispatch = dispatchMock;
  },
}));

const DISBURSEMENT = {
  id: "disb_1",
  txHash: "tx_1",
  sender: "GSENDER",
  receiver: "GRECEIVER",
  amount: 1000n,
};

// ═══════════════════════════════════════════════════════════════
// State machine — pure logic (no DB dependency)
// ═══════════════════════════════════════════════════════════════

describe("payment status state machine", () => {
  it("covers every declared status in ALLOWED_TRANSITIONS", () => {
    for (const status of PAYMENT_TRACKING_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("allows the documented happy path", () => {
    expect(isValidTransition("INITIATED", "PENDING")).toBe(true);
    expect(isValidTransition("PENDING", "PROCESSING")).toBe(true);
    expect(isValidTransition("PROCESSING", "CONFIRMED")).toBe(true);
    expect(isValidTransition("CONFIRMED", "REFUNDED")).toBe(true);
  });

  it("allows failure from any in-flight state", () => {
    expect(isValidTransition("INITIATED", "FAILED")).toBe(true);
    expect(isValidTransition("PENDING", "FAILED")).toBe(true);
    expect(isValidTransition("PROCESSING", "FAILED")).toBe(true);
  });

  it("allows retrying a failed payment back to PENDING", () => {
    expect(isValidTransition("FAILED", "PENDING")).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(isValidTransition("INITIATED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("INITIATED", "REFUNDED")).toBe(false);
    expect(isValidTransition("PENDING", "CONFIRMED")).toBe(false);
  });

  it("rejects refunding a payment that never confirmed", () => {
    expect(isValidTransition("PENDING", "REFUNDED")).toBe(false);
    expect(isValidTransition("PROCESSING", "REFUNDED")).toBe(false);
    expect(isValidTransition("FAILED", "REFUNDED")).toBe(false);
  });

  it("treats REFUNDED as terminal", () => {
    expect(ALLOWED_TRANSITIONS.REFUNDED).toHaveLength(0);
  });

  it("rejects moving backwards", () => {
    expect(isValidTransition("PROCESSING", "PENDING")).toBe(false);
    expect(isValidTransition("CONFIRMED", "PROCESSING")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// PaymentStatusService — DB-backed behavior (mocked prisma)
// ═══════════════════════════════════════════════════════════════

describe("PaymentStatusService", () => {
  let svc: PaymentStatusService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new PaymentStatusService();
  });

  describe("getCurrentStatus", () => {
    it("throws NotFoundError when the disbursement does not exist", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue(null as never);
      await expect(svc.getCurrentStatus("missing")).rejects.toThrow(NotFoundError);
    });

    it("defaults to INITIATED when no events are recorded", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue({ id: "disb_1" } as never);
      vi.mocked(prisma.paymentStatusEvent.findFirst).mockResolvedValue(null as never);

      const status = await svc.getCurrentStatus("disb_1");
      expect(status).toBe("INITIATED");
    });

    it("returns the most recent event's status", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue({ id: "disb_1" } as never);
      vi.mocked(prisma.paymentStatusEvent.findFirst).mockResolvedValue({
        status: "PROCESSING",
      } as never);

      const status = await svc.getCurrentStatus("disb_1");
      expect(status).toBe("PROCESSING");
    });
  });

  describe("getTimeline", () => {
    it("throws NotFoundError when the disbursement does not exist", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue(null as never);
      await expect(svc.getTimeline("missing")).rejects.toThrow(NotFoundError);
    });

    it("returns events ordered oldest first", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue({ id: "disb_1" } as never);
      const events = [
        { id: "evt_1", status: "INITIATED", previousStatus: null },
        { id: "evt_2", status: "PENDING", previousStatus: "INITIATED" },
      ];
      vi.mocked(prisma.paymentStatusEvent.findMany).mockResolvedValue(events as never);

      const timeline = await svc.getTimeline("disb_1");
      expect(timeline).toEqual(events);
      expect(prisma.paymentStatusEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "asc" } }),
      );
    });
  });

  describe("transition", () => {
    it("throws NotFoundError when the disbursement does not exist", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue(null as never);
      await expect(svc.transition("missing", "PENDING")).rejects.toThrow(NotFoundError);
    });

    it("rejects an invalid transition without writing or dispatching", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue(DISBURSEMENT as never);
      vi.mocked(prisma.paymentStatusEvent.findFirst).mockResolvedValue(null as never); // current: INITIATED

      await expect(svc.transition("disb_1", "CONFIRMED")).rejects.toThrow(BusinessRuleError);
      expect(prisma.paymentStatusEvent.create).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("persists a valid transition and dispatches a status webhook", async () => {
      vi.mocked(prisma.disbursement.findUnique).mockResolvedValue(DISBURSEMENT as never);
      vi.mocked(prisma.paymentStatusEvent.findFirst).mockResolvedValue(null as never); // current: INITIATED

      const created = {
        id: "evt_1",
        disbursementId: "disb_1",
        status: "PENDING" as PaymentTrackingStatus,
        previousStatus: "INITIATED" as PaymentTrackingStatus,
        note: "queued",
        createdAt: new Date(),
      };
      vi.mocked(prisma.paymentStatusEvent.create).mockResolvedValue(created as never);

      const result = await svc.transition("disb_1", "PENDING", "queued");

      expect(result).toEqual(created);
      expect(prisma.paymentStatusEvent.create).toHaveBeenCalledWith({
        data: {
          disbursementId: "disb_1",
          status: "PENDING",
          previousStatus: "INITIATED",
          note: "queued",
        },
      });
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "payment_status_pending",
          disbursementId: "disb_1",
          txHash: DISBURSEMENT.txHash,
          previousStatus: "INITIATED",
          status: "PENDING",
        }),
      );
    });
  });
});
