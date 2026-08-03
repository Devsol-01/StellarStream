import { prisma } from "../lib/db.js";
import { NotFoundError, BusinessRuleError } from "../lib/app-error.js";
import { WebhookDispatcherService } from "./webhook-dispatcher.service.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export const PAYMENT_TRACKING_STATUSES = [
  "INITIATED",
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentTrackingStatus = (typeof PAYMENT_TRACKING_STATUSES)[number];

export interface StatusTimelineEntry {
  id: string;
  disbursementId: string;
  status: PaymentTrackingStatus;
  previousStatus: PaymentTrackingStatus | null;
  note: string | null;
  createdAt: Date;
}

/**
 * Valid forward transitions for the payment status timeline. A disbursement
 * with no recorded events is implicitly INITIATED.
 *
 * FAILED -> PENDING allows a retried payment to re-enter the pipeline;
 * CONFIRMED -> REFUNDED is the only path into REFUNDED (can't refund a
 * payment that never confirmed).
 */
export const ALLOWED_TRANSITIONS: Record<
  PaymentTrackingStatus,
  readonly PaymentTrackingStatus[]
> = {
  INITIATED: ["PENDING", "FAILED"],
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["REFUNDED"],
  FAILED: ["PENDING"],
  REFUNDED: [],
};

/** Pure check (no DB) so the state machine can be unit-tested directly. */
export function isValidTransition(
  from: PaymentTrackingStatus,
  to: PaymentTrackingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class PaymentStatusService {
  private webhookDispatcher = new WebhookDispatcherService();

  /**
   * The current status is the most recent recorded event; a disbursement
   * with no events yet is implicitly INITIATED.
   */
  async getCurrentStatus(disbursementId: string): Promise<PaymentTrackingStatus> {
    const disbursement = await prisma.disbursement.findUnique({
      where: { id: disbursementId },
      select: { id: true },
    });
    if (!disbursement) throw new NotFoundError("Disbursement", disbursementId);

    const latest = await prisma.paymentStatusEvent.findFirst({
      where: { disbursementId },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    return (latest?.status as PaymentTrackingStatus | undefined) ?? "INITIATED";
  }

  /** Full ordered timeline for visualization, oldest first. */
  async getTimeline(disbursementId: string): Promise<StatusTimelineEntry[]> {
    const disbursement = await prisma.disbursement.findUnique({
      where: { id: disbursementId },
      select: { id: true },
    });
    if (!disbursement) throw new NotFoundError("Disbursement", disbursementId);

    const events = await prisma.paymentStatusEvent.findMany({
      where: { disbursementId },
      orderBy: { createdAt: "asc" },
    });
    return events as StatusTimelineEntry[];
  }

  /**
   * Record a status transition. Validates the transition against the
   * allowed state machine, persists the event, and fires a
   * `payment_status_<status>` webhook.
   */
  async transition(
    disbursementId: string,
    nextStatus: PaymentTrackingStatus,
    note?: string,
  ): Promise<StatusTimelineEntry> {
    const disbursement = await prisma.disbursement.findUnique({
      where: { id: disbursementId },
    });
    if (!disbursement) throw new NotFoundError("Disbursement", disbursementId);

    const currentStatus = await this.getCurrentStatus(disbursementId);

    if (!isValidTransition(currentStatus, nextStatus)) {
      throw new BusinessRuleError(
        `Invalid payment status transition: ${currentStatus} -> ${nextStatus}`,
        { details: { from: currentStatus, to: nextStatus } },
      );
    }

    const event = await prisma.paymentStatusEvent.create({
      data: {
        disbursementId,
        status: nextStatus,
        previousStatus: currentStatus,
        note: note ?? null,
      },
    });

    await this.webhookDispatcher.dispatch({
      eventType: `payment_status_${nextStatus.toLowerCase()}`,
      disbursementId,
      txHash: disbursement.txHash,
      sender: disbursement.sender,
      receiver: disbursement.receiver,
      amount: disbursement.amount.toString(),
      previousStatus: currentStatus,
      status: nextStatus,
      note: note ?? null,
      timestamp: new Date().toISOString(),
    });

    return event as StatusTimelineEntry;
  }
}
