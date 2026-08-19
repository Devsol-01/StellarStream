import { describe, it, expect } from "vitest";
import {
  computeExpiresAt,
  isExpired,
  remainingAmount,
  validateHoldPeriod,
  validateCaptureAmount,
  nextStatusAfterCapture,
  MIN_HOLD_PERIOD_SECS,
  MAX_HOLD_PERIOD_SECS,
} from "../services/payment-authorization.service.js";

// ═══════════════════════════════════════════════════════════════
// PaymentAuthorizationService — pure logic (no DB dependency)
// ═══════════════════════════════════════════════════════════════

describe("PaymentAuthorizationService", () => {
  describe("computeExpiresAt / isExpired", () => {
    it("computes expiresAt as authorizedAt + holdPeriodSecs", () => {
      const authorizedAt = new Date("2026-01-01T00:00:00.000Z");
      const expiresAt = computeExpiresAt(authorizedAt, 3600);
      expect(expiresAt.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    });

    it("is not expired before expiresAt", () => {
      const expiresAt = new Date("2026-01-01T01:00:00.000Z");
      const now = new Date("2026-01-01T00:59:59.000Z");
      expect(isExpired(expiresAt, now)).toBe(false);
    });

    it("is expired exactly at expiresAt", () => {
      const expiresAt = new Date("2026-01-01T01:00:00.000Z");
      expect(isExpired(expiresAt, expiresAt)).toBe(true);
    });

    it("is expired after expiresAt", () => {
      const expiresAt = new Date("2026-01-01T01:00:00.000Z");
      const now = new Date("2026-01-01T01:00:01.000Z");
      expect(isExpired(expiresAt, now)).toBe(true);
    });
  });

  describe("validateHoldPeriod", () => {
    it("accepts values within bounds", () => {
      expect(() => validateHoldPeriod(MIN_HOLD_PERIOD_SECS)).not.toThrow();
      expect(() => validateHoldPeriod(MAX_HOLD_PERIOD_SECS)).not.toThrow();
      expect(() => validateHoldPeriod(3600)).not.toThrow();
    });

    it("rejects a hold period below the minimum", () => {
      expect(() => validateHoldPeriod(MIN_HOLD_PERIOD_SECS - 1)).toThrow(
        /holdPeriodSecs must be/,
      );
    });

    it("rejects a hold period above the maximum", () => {
      expect(() => validateHoldPeriod(MAX_HOLD_PERIOD_SECS + 1)).toThrow(
        /holdPeriodSecs must be/,
      );
    });

    it("rejects a non-integer hold period", () => {
      expect(() => validateHoldPeriod(60.5)).toThrow(/holdPeriodSecs must be/);
    });
  });

  describe("remainingAmount", () => {
    it("returns the uncaptured balance", () => {
      expect(remainingAmount(BigInt(1000), BigInt(400))).toBe(BigInt(600));
    });

    it("returns zero once fully captured", () => {
      expect(remainingAmount(BigInt(1000), BigInt(1000))).toBe(BigInt(0));
    });
  });

  describe("validateCaptureAmount", () => {
    it("accepts an amount within the remaining balance", () => {
      expect(() => validateCaptureAmount(BigInt(500), BigInt(1000))).not.toThrow();
    });

    it("accepts capturing exactly the remaining balance", () => {
      expect(() => validateCaptureAmount(BigInt(1000), BigInt(1000))).not.toThrow();
    });

    it("rejects a zero capture amount", () => {
      expect(() => validateCaptureAmount(BigInt(0), BigInt(1000))).toThrow(
        /greater than zero/,
      );
    });

    it("rejects a negative capture amount", () => {
      expect(() => validateCaptureAmount(BigInt(-1), BigInt(1000))).toThrow(
        /greater than zero/,
      );
    });

    it("rejects a capture amount exceeding the remaining balance", () => {
      expect(() => validateCaptureAmount(BigInt(1001), BigInt(1000))).toThrow(
        /exceeds remaining held amount/,
      );
    });
  });

  describe("nextStatusAfterCapture", () => {
    it("stays PARTIALLY_CAPTURED when less than the full amount is captured", () => {
      expect(nextStatusAfterCapture(BigInt(1000), BigInt(400))).toBe(
        "PARTIALLY_CAPTURED",
      );
    });

    it("becomes CAPTURED once the full amount is captured", () => {
      expect(nextStatusAfterCapture(BigInt(1000), BigInt(1000))).toBe("CAPTURED");
    });

    it("supports accumulating partial captures to a full capture", () => {
      let captured = BigInt(0);
      const total = BigInt(1000);

      captured += BigInt(300);
      expect(nextStatusAfterCapture(total, captured)).toBe("PARTIALLY_CAPTURED");

      captured += BigInt(700);
      expect(nextStatusAfterCapture(total, captured)).toBe("CAPTURED");
    });
  });
});
