import { ValidationError } from "../lib/app-error.js";

// ── Decimal-safe money math ─────────────────────────────────────────────────
//
// Amounts are stored/passed around as decimal strings (see Stream.amount,
// Disbursement.amount comments elsewhere in the codebase: "Store as string
// to handle large numbers safely"). We scale to Stellar's native 7-decimal
// precision and do the arithmetic in BigInt to avoid float drift, the same
// way PaymentAuthorizationService does for stroop amounts.

const AMOUNT_SCALE = 7;
const AMOUNT_FACTOR = 10n ** BigInt(AMOUNT_SCALE);

// Tax rate precision: 0.0001% granularity is far beyond any real-world tax
// schedule, but keeps rounding deterministic regardless of the input float.
const RATE_SCALE = 4;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

/** Parse a non-negative decimal string into a scaled BigInt (7 decimals). */
export function parseAmount(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new ValidationError(`Invalid amount: "${value}"`);
  }
  const [whole, frac = ""] = value.split(".");
  if (frac.length > AMOUNT_SCALE) {
    throw new ValidationError(
      `Amount "${value}" exceeds ${AMOUNT_SCALE} decimal places`,
    );
  }
  return BigInt(whole) * AMOUNT_FACTOR + BigInt(frac.padEnd(AMOUNT_SCALE, "0") || "0");
}

/** Format a scaled BigInt back into a trimmed decimal string. */
export function formatAmount(scaled: bigint): string {
  if (scaled < 0n) {
    throw new ValidationError("Amount cannot be negative");
  }
  const whole = scaled / AMOUNT_FACTOR;
  const frac = scaled % AMOUNT_FACTOR;
  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(AMOUNT_SCALE, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export interface InvoiceRecipientAmount {
  amount: string;
}

/** Sum recipient amounts into a decimal-string subtotal. */
export function calculateInvoiceSubtotal(recipients: InvoiceRecipientAmount[]): string {
  if (recipients.length === 0) {
    throw new ValidationError("At least one recipient is required");
  }

  let total = 0n;
  for (const recipient of recipients) {
    const scaled = parseAmount(recipient.amount);
    if (scaled <= 0n) {
      throw new ValidationError(
        `Recipient amount must be greater than zero: "${recipient.amount}"`,
      );
    }
    total += scaled;
  }

  return formatAmount(total);
}

export interface TaxBreakdown {
  taxAmount: string;
  totalAmount: string;
}

/**
 * Compute tax and total from a subtotal and a percentage tax rate (0-100,
 * fractional rates like 7.25 allowed). Rounds half-up to the nearest
 * 0.0000001 (Stellar's smallest unit).
 */
export function calculateInvoiceTax(subtotal: string, taxRatePercent: number): TaxBreakdown {
  if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100) {
    throw new ValidationError("taxRate must be a number between 0 and 100");
  }

  const subtotalScaled = parseAmount(subtotal);
  const rateScaled = BigInt(Math.round(taxRatePercent * Number(RATE_FACTOR)));
  const denominator = 100n * RATE_FACTOR;
  const numerator = subtotalScaled * rateScaled;
  const taxScaled = (numerator + denominator / 2n) / denominator;
  const totalScaled = subtotalScaled + taxScaled;

  return {
    taxAmount: formatAmount(taxScaled),
    totalAmount: formatAmount(totalScaled),
  };
}
