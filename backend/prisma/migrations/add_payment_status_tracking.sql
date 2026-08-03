-- Migration: Payment Status Tracking System (#1369)
-- Adds a fine-grained payment lifecycle timeline (Initiated -> Pending ->
-- Processing -> Confirmed -> Failed -> Refunded) on top of Disbursement,
-- independent from the existing DisbursementStatus used by the batch engine.

CREATE TYPE IF NOT EXISTS "PaymentTrackingStatus" AS ENUM (
  'INITIATED', 'PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'REFUNDED'
);

CREATE TABLE IF NOT EXISTS "PaymentStatusEvent" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "disbursementId" TEXT NOT NULL,
  "status"         "PaymentTrackingStatus" NOT NULL,
  "previousStatus" "PaymentTrackingStatus",
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentStatusEvent_disbursementId_fkey"
    FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "PaymentStatusEvent_disbursementId_createdAt_idx"
  ON "PaymentStatusEvent"("disbursementId", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentStatusEvent_status_idx"
  ON "PaymentStatusEvent"("status");
