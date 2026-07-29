-- Create Report table
CREATE TABLE "Report" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL, -- daily_summary, monthly_statement, failed_payment, fee_analysis, tax_report
  "periodStart" TIMESTAMP NOT NULL,
  "periodEnd" TIMESTAMP NOT NULL,
  "generatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', -- pending, generating, generated, failed
  "fileUrls" JSONB,
  "summary" JSONB NOT NULL, -- transactionCount, totalVolume, failureCount, feeTotal
  "reconciliationStatus" JSONB, -- totalExpected, totalActual, variance, discrepanciesFound
  "emailDeliveryStatus" JSONB, -- sent, sentAt, recipients, failureReason
  "failureReason" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_report_organization_created" ON "Report"("organizationId", "createdAt");
CREATE INDEX "idx_report_type_organization" ON "Report"("reportType", "organizationId");
CREATE INDEX "idx_report_status" ON "Report"("status");
CREATE INDEX "idx_report_period" ON "Report"("periodStart", "periodEnd");

-- Create ReportConfiguration table
CREATE TABLE "ReportConfiguration" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL UNIQUE,
  "reportType" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "scheduleFrequency" TEXT NOT NULL, -- daily, monthly, on_failure, manual
  "scheduleTimeUtc" TEXT, -- HH:MM format
  "scheduleDayOfMonth" INTEGER DEFAULT 31, -- For monthly reports
  "exportFormats" TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'xlsx'], -- pdf, xlsx, json, csv
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "emailIncludePreview" BOOLEAN NOT NULL DEFAULT true,
  "emailAttachmentFormats" TEXT[] NOT NULL DEFAULT ARRAY['pdf'],
  "storageProvider" TEXT NOT NULL DEFAULT 's3', -- s3, gcs
  "storageBucket" TEXT NOT NULL,
  "retentionDays" INTEGER NOT NULL DEFAULT 2555, -- 7 years
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_report_config_organization" ON "ReportConfiguration"("organizationId");

-- Create ReportAuditLog table
CREATE TABLE "ReportAuditLog" (
  "id" TEXT PRIMARY KEY,
  "reportId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "action" TEXT NOT NULL, -- generated, emailed, viewed, deleted, failed
  "actor" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE,
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_report_audit_log_report" ON "ReportAuditLog"("reportId");
CREATE INDEX "idx_report_audit_log_organization" ON "ReportAuditLog"("organizationId");
CREATE INDEX "idx_report_audit_log_created" ON "ReportAuditLog"("createdAt");
