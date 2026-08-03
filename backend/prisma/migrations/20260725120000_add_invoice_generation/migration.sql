-- Migration: Payment Invoice Generation
-- Adds persisted, numbered invoices (with tax breakdown and lifecycle status),
-- reusable invoice templates, and an atomic per-owner/per-year numbering
-- counter backing Invoice.invoiceNumber.

CREATE TYPE "InvoiceStatus" AS ENUM (
  'DRAFT',
  'ISSUED',
  'PAID',
  'VOID'
);

CREATE TABLE IF NOT EXISTS "InvoiceTemplate" (
  "id"           TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ownerAddress" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "language"     TEXT NOT NULL DEFAULT 'en',
  "isDefault"    BOOLEAN NOT NULL DEFAULT false,
  "accentColor"  TEXT NOT NULL DEFAULT '#00f5ff',
  "logoBase64"   TEXT,
  "footerText"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceTemplate_ownerAddress_name_key"
  ON "InvoiceTemplate"("ownerAddress", "name");

CREATE INDEX IF NOT EXISTS "InvoiceTemplate_ownerAddress_idx"
  ON "InvoiceTemplate"("ownerAddress");

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "invoiceNumber"  TEXT NOT NULL,
  "ownerAddress"   TEXT NOT NULL,
  "disbursementId" TEXT REFERENCES "Disbursement"("id") ON DELETE SET NULL,
  "templateId"     TEXT REFERENCES "InvoiceTemplate"("id") ON DELETE SET NULL,
  "status"         "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "language"       TEXT NOT NULL DEFAULT 'en',
  "sender"         TEXT NOT NULL,
  "asset"          TEXT NOT NULL,
  "recipients"     JSONB NOT NULL,
  "subtotal"       TEXT NOT NULL,
  "taxRate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount"      TEXT NOT NULL DEFAULT '0',
  "totalAmount"    TEXT NOT NULL,
  "note"           TEXT,
  "txHash"         TEXT,
  "issuedAt"       TIMESTAMP(3),
  "dueAt"          TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key"
  ON "Invoice"("invoiceNumber");

CREATE INDEX IF NOT EXISTS "Invoice_ownerAddress_idx"
  ON "Invoice"("ownerAddress");

CREATE INDEX IF NOT EXISTS "Invoice_status_idx"
  ON "Invoice"("status");

CREATE INDEX IF NOT EXISTS "Invoice_disbursementId_idx"
  ON "Invoice"("disbursementId");

CREATE INDEX IF NOT EXISTS "Invoice_ownerAddress_createdAt_idx"
  ON "Invoice"("ownerAddress", "createdAt");

CREATE TABLE IF NOT EXISTS "InvoiceCounter" (
  "ownerAddress" TEXT NOT NULL,
  "year"         INTEGER NOT NULL,
  "lastSeq"      INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("ownerAddress", "year")
);
