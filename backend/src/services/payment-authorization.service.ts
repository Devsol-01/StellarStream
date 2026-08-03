import { prisma } from "../lib/db.js";
import type { AuthorizationStatus } from "../generated/client/index.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../lib/app-error.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateAuthorizationInput {
  payerAddress: string;
  payeeAddress: string;
  tokenAddress: string;
  amount: string;
  holdPeriodSecs: number;
}

export interface AuthorizationFilter {
  payerAddress?: string;
  payeeAddress?: string;
  status?: AuthorizationStatus;
}

const ACTIVE_STATUSES = ["AUTHORIZED", "PARTIALLY_CAPTURED"] as const;
const TERMINAL_STATUSES = ["CAPTURED", "RELEASED", "EXPIRED"] as const;

// ── Bounds ────────────────────────────────────────────────────────────────────

export const MIN_HOLD_PERIOD_SECS = 60; // 1 minute
export const MAX_HOLD_PERIOD_SECS = 30 * 24 * 60 * 60; // 30 days

// ── Pure helpers (no DB) ──────────────────────────────────────────────────────

/** Compute the moment a hold expires given when it was authorized. */
export function computeExpiresAt(authorizedAt: Date, holdPeriodSecs: number): Date {
  return new Date(authorizedAt.getTime() + holdPeriodSecs * 1000);
}

/** Whether a hold's window has elapsed as of `now`. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Amount still available to capture or release. */
export function remainingAmount(totalAmount: bigint, capturedAmount: bigint): bigint {
  return totalAmount - capturedAmount;
}

/**
 * Validate a hold period is within the allowed bounds. Pure so it can be
 * unit-tested and reused as defense-in-depth alongside the Zod route schema.
 */
export function validateHoldPeriod(holdPeriodSecs: number): void {
  if (
    !Number.isInteger(holdPeriodSecs) ||
    holdPeriodSecs < MIN_HOLD_PERIOD_SECS ||
    holdPeriodSecs > MAX_HOLD_PERIOD_SECS
  ) {
    throw new ValidationError(
      `holdPeriodSecs must be an integer between ${MIN_HOLD_PERIOD_SECS} and ${MAX_HOLD_PERIOD_SECS}`,
    );
  }
}

/**
 * Validate a requested capture amount against what remains on the hold.
 * Pure (no DB) so the arithmetic rules are unit-testable in isolation.
 */
export function validateCaptureAmount(captureAmt: bigint, remaining: bigint): void {
  if (captureAmt <= BigInt(0)) {
    throw new ValidationError("Capture amount must be greater than zero");
  }
  if (captureAmt > remaining) {
    throw new ValidationError(
      `Capture amount (${captureAmt}) exceeds remaining held amount (${remaining})`,
    );
  }
}

/** Status an authorization should transition to after a capture is applied. */
export function nextStatusAfterCapture(totalAmount: bigint, newCapturedAmount: bigint): "CAPTURED" | "PARTIALLY_CAPTURED" {
  return newCapturedAmount === totalAmount ? "CAPTURED" : "PARTIALLY_CAPTURED";
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PaymentAuthorizationService {
  // ── Create ───────────────────────────────────────────────────────────────

  async createAuthorization(input: CreateAuthorizationInput) {
    validateHoldPeriod(input.holdPeriodSecs);

    const amount = BigInt(input.amount);
    if (amount <= BigInt(0)) {
      throw new ValidationError("amount must be greater than zero");
    }

    const authorizedAt = new Date();
    const expiresAt = computeExpiresAt(authorizedAt, input.holdPeriodSecs);

    return prisma.paymentAuthorization.create({
      data: {
        payerAddress: input.payerAddress,
        payeeAddress: input.payeeAddress,
        tokenAddress: input.tokenAddress,
        amount,
        holdPeriodSecs: input.holdPeriodSecs,
        authorizedAt,
        expiresAt,
      },
      include: { captures: true },
    });
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async getAuthorization(id: string) {
    await this._expireDueHolds();

    const auth = await prisma.paymentAuthorization.findUnique({
      where: { id },
      include: { captures: { orderBy: { createdAt: "asc" } } },
    });
    if (!auth) throw new NotFoundError("Authorization not found");
    return auth;
  }

  async listAuthorizations(filter: AuthorizationFilter = {}) {
    await this._expireDueHolds();

    return prisma.paymentAuthorization.findMany({
      where: {
        ...(filter.payerAddress ? { payerAddress: filter.payerAddress } : {}),
        ...(filter.payeeAddress ? { payeeAddress: filter.payeeAddress } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { captures: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── Capture ──────────────────────────────────────────────────────────────

  /**
   * Capture some or all of the held amount. Omitting `amount` captures the
   * full remaining balance. Repeatable until the hold is fully captured,
   * released, or its hold period has expired.
   */
  async captureAuthorization(id: string, amount?: string, txHash?: string) {
    await this._expireDueHolds();

    const auth = await prisma.paymentAuthorization.findUnique({ where: { id } });
    if (!auth) throw new NotFoundError("Authorization not found");

    this._assertActive(auth.status, "captured");

    const remaining = remainingAmount(auth.amount, auth.capturedAmount);
    const captureAmt = amount !== undefined ? BigInt(amount) : remaining;
    validateCaptureAmount(captureAmt, remaining);

    const newCapturedAmount = auth.capturedAmount + captureAmt;
    const newStatus = nextStatusAfterCapture(auth.amount, newCapturedAmount);

    return prisma.$transaction(async (tx) => {
      await tx.paymentCapture.create({
        data: { authorizationId: id, amount: captureAmt, txHash },
      });
      return tx.paymentAuthorization.update({
        where: { id },
        data: { capturedAmount: newCapturedAmount, status: newStatus },
        include: { captures: { orderBy: { createdAt: "asc" } } },
      });
    });
  }

  // ── Release ──────────────────────────────────────────────────────────────

  /** Release the uncaptured remainder of a hold back to the payer. */
  async releaseAuthorization(id: string) {
    await this._expireDueHolds();

    const auth = await prisma.paymentAuthorization.findUnique({ where: { id } });
    if (!auth) throw new NotFoundError("Authorization not found");

    this._assertActive(auth.status, "released");

    return prisma.paymentAuthorization.update({
      where: { id },
      data: { status: "RELEASED", releasedAt: new Date() },
      include: { captures: { orderBy: { createdAt: "asc" } } },
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _assertActive(status: string, action: "captured" | "released"): void {
    if ((TERMINAL_STATUSES as readonly string[]).includes(status)) {
      throw new ConflictError(
        `Authorization is ${status} and can no longer be ${action}`,
      );
    }
  }

  /** Flip any holds whose window has elapsed to EXPIRED (automatic expiry). */
  private async _expireDueHolds(): Promise<void> {
    await prisma.paymentAuthorization.updateMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        expiresAt: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });
  }
}
