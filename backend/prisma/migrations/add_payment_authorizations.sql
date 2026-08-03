-- Migration: Payment Pre-Authorization Feature (#1373)
-- Adds hold-and-capture support: create an authorization hold, capture it
-- (fully or partially) within the hold period, or release the remainder.

CREATE TYPE "AuthorizationStatus" AS ENUM (
  'AUTHORIZED',
  'PARTIALLY_CAPTURED',
  'CAPTURED',
  'RELEASED',
  'EXPIRED'
);

CREATE TABLE IF NOT EXISTS "PaymentAuthorization" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "payerAddress"   TEXT NOT NULL,
  "payeeAddress"   TEXT NOT NULL,
  "tokenAddress"   TEXT NOT NULL,
  "amount"         BIGINT NOT NULL,
  "capturedAmount" BIGINT NOT NULL DEFAULT 0,
  "status"         "AuthorizationStatus" NOT NULL DEFAULT 'AUTHORIZED',
  "holdPeriodSecs" INTEGER NOT NULL,
  "authorizedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "releasedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PaymentAuthorization_payerAddress_idx"
  ON "PaymentAuthorization"("payerAddress");

CREATE INDEX IF NOT EXISTS "PaymentAuthorization_payeeAddress_idx"
  ON "PaymentAuthorization"("payeeAddress");

CREATE INDEX IF NOT EXISTS "PaymentAuthorization_status_idx"
  ON "PaymentAuthorization"("status");

CREATE INDEX IF NOT EXISTS "PaymentAuthorization_expiresAt_idx"
  ON "PaymentAuthorization"("expiresAt");

CREATE TABLE IF NOT EXISTS "PaymentCapture" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "authorizationId" TEXT NOT NULL REFERENCES "PaymentAuthorization"("id") ON DELETE CASCADE,
  "amount"          BIGINT NOT NULL,
  "txHash"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PaymentCapture_authorizationId_idx"
  ON "PaymentCapture"("authorizationId");
