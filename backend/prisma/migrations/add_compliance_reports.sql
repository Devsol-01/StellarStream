-- Migration: add_compliance_reports (#1359)
-- Adds ComplianceReport table: an immutable, checksummed record of every
-- generated regulatory report (AML/KYC, transaction monitoring, suspicious
-- activity, regulatory filing bundles, audit trails).
--
-- The report file itself is written to secure on-disk storage
-- (backend/storage/compliance-reports, 0600/0700 permissions, outside any
-- statically served directory). This table stores only the file's location,
-- a SHA-256 checksum for tamper detection, and generation metadata —
-- never the file content or raw PII beyond what's needed to locate it.

CREATE TABLE IF NOT EXISTS "ComplianceReport" (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type    TEXT        NOT NULL, -- AML_KYC | TRANSACTION_MONITORING | SUSPICIOUS_ACTIVITY | REGULATORY_FILING | AUDIT_TRAIL
  format         TEXT        NOT NULL, -- pdf | csv | xlsx
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,
  record_count   INTEGER     NOT NULL DEFAULT 0,
  file_path      TEXT        NOT NULL,
  checksum_sha256 TEXT       NOT NULL,
  generated_by   TEXT        NOT NULL DEFAULT 'system', -- admin identifier, or 'system' for scheduled runs
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_report_type       ON "ComplianceReport" (report_type);
CREATE INDEX IF NOT EXISTS idx_compliance_report_created    ON "ComplianceReport" (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_report_period     ON "ComplianceReport" (period_start, period_end);
