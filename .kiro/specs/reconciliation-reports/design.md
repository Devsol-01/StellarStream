# Reconciliation Reports - Technical Design

## Architecture

```
┌─ Reconciliation Reports System ──────────────────────────────────┐
│                                                                   │
│  ┌─ Report Engine ────────────────┐  ┌─ Scheduler ────────────┐  │
│  │ • TransactionSummary           │  │ • Daily @ 00:00 UTC    │  │
│  │ • MonthlyStatement             │  │ • Monthly @ 23:00 UTC  │  │
│  │ • FailedPaymentReport          │  │ • Real-time (failures) │  │
│  │ • FeeAnalysisReport            │  │ • On-demand via API    │  │
│  │ • TaxReport                    │  └────────────────────────┘  │
│  └────────────────────────────────┘                              │
│           ↓ generates                                             │
│  ┌─ Report Formatters ────────────────────────────────────────┐  │
│  │ • PDFFormatter (ReportLab)                                 │  │
│  │ • ExcelFormatter (OpenPyXL/ExcelJS)                        │  │
│  │ • JSONFormatter                                            │  │
│  │ • CSVFormatter                                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│           ↓ exports to                                            │
│  ┌─ Storage & Delivery ───────────────────────────────────────┐  │
│  │ • S3/GCS cloud storage                                     │  │
│  │ • EmailService (SMTP)                                      │  │
│  │ • Database (metadata + audit)                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Data Model

### Report Entity
```typescript
interface Report {
  id: string;                    // UUID
  organizationId: string;        // FK -> Organization
  reportType: ReportType;        // daily_summary | monthly | failed | fee_analysis | tax
  periodStart: Date;             // Report period
  periodEnd: Date;
  generatedAt: Date;
  generatedBy: string;           // User/system that triggered
  status: ReportStatus;          // pending | generated | failed
  fileUrls: {                     // Storage URLs per format
    pdf?: string;
    xlsx?: string;
    json?: string;
    csv?: string;
  };
  summary: {                      // Quick stats
    transactionCount: number;
    totalVolume: Decimal;
    failureCount?: number;
    feeTotal?: Decimal;
  };
  reconciliationStatus: {         // Reconciliation data
    totalExpected: Decimal;
    totalActual: Decimal;
    variance: Decimal;
    discrepanciesFound: boolean;
    explanations?: string[];
  };
  emailDeliveryStatus?: {         // Email tracking
    sent: boolean;
    sentAt?: Date;
    recipients: string[];
    failureReason?: string;
  };
  auditLog: AuditEntry[];
}

type ReportType = 'daily_summary' | 'monthly_statement' | 'failed_payment' | 'fee_analysis' | 'tax_report';
type ReportStatus = 'pending' | 'generating' | 'generated' | 'failed';
```

### Report Configuration Entity
```typescript
interface ReportConfiguration {
  organizationId: string;         // FK -> Organization
  reportType: ReportType;
  enabled: boolean;
  schedule: {
    frequency: 'daily' | 'monthly' | 'on_failure' | 'manual';
    timeUtc?: string;              // HH:MM for daily/monthly
    dayOfMonth?: number;           // For monthly (default: last day)
  };
  exportFormats: ('pdf' | 'xlsx' | 'json' | 'csv')[];  // Default: [pdf, xlsx]
  emailConfig?: {
    enabled: boolean;
    recipients: string[];
    includePreview: boolean;
    attachmentFormats: ('pdf' | 'xlsx')[];
  };
  storageConfig: {
    provider: 's3' | 'gcs';
    bucket: string;
    retentionDays: number;        // Default: 2555 (7 years)
  };
  createdAt: Date;
  updatedAt: Date;
}
```

## Services

### 1. ReportGenerationService
Responsible for generating reports from transaction data.

**Methods:**
- `generateDailyTransactionSummary(orgId, date)`
- `generateMonthlyStatement(orgId, year, month)`
- `generateFailedPaymentReport(orgId, paymentId)`
- `generateFeeAnalysisReport(orgId, periodStart, periodEnd)`
- `generateTaxReport(orgId, year, jurisdiction)`
- `reconcileTransactions(orgId, reportData)` - Cross-validate with blockchain

**Data aggregation:**
- Query transaction tables filtered by organization
- Aggregate by date/type/status
- Calculate totals and percentages
- Identify discrepancies

### 2. ReportFormatterService
Handles conversion of report data to different formats.

**Methods:**
- `formatAsPDF(reportData) → ArrayBuffer`
- `formatAsExcel(reportData) → ArrayBuffer`
- `formatAsJSON(reportData) → string`
- `formatAsCSV(reportData) → string`

**PDF generation:**
- Use ReportLab (Python) or PDFKit (Node)
- Include header with org logo/name
- Tables with proper formatting
- Summary statistics page
- Digital signature/certification

**Excel generation:**
- Multiple sheets per report type
- Formatting (borders, colors, freeze panes)
- Summary statistics
- Data validation where applicable

### 3. ReportStorageService
Manages report persistence and retrieval.

**Methods:**
- `storeReport(orgId, reportType, files) → storageUrls`
- `retrieveReport(reportId) → Report`
- `listReports(orgId, filters) → Report[]`
- `deleteOldReports(orgId, retentionDays)`
- `verifyIntegrity(reportId)` - Check digital signature

**Storage:**
- Cloud storage (S3/GCS) for report files
- Database for metadata
- Encryption at rest
- Versioning support

### 4. ReportSchedulerService
Manages scheduled report generation.

**Methods:**
- `scheduleReport(config) → void`
- `getScheduledReports(orgId) → ScheduledReport[]`
- `updateSchedule(reportId, newConfig)`
- `disableSchedule(reportId)`
- `processScheduledReports()` - Cron job

**Scheduling:**
- Daily @ 00:00 UTC (transaction summaries)
- Monthly @ 23:00 UTC (statements)
- Real-time on payment failure
- Configurable per organization

### 5. ReportEmailService
Handles email delivery of reports.

**Methods:**
- `sendReport(reportId, recipients) → void`
- `sendToConfiguredRecipients(reportId) → void`
- `createEmailTemplate(reportType, reportData) → htmlBody`
- `attachReportFiles(reportId, formats) → attachments`

**Email delivery:**
- HTML email body with report summary
- Attachments (PDF/Excel as configured)
- Branding with organization logo
- Unsubscribe/preference management
- Delivery tracking

## API Endpoints

### GET /api/v1/orgs/:gAddress/reports
List all reports for organization (EXECUTOR+)
- Query params: `type`, `startDate`, `endDate`, `status`
- Response: `Report[]` (paginated)

### POST /api/v1/orgs/:gAddress/reports/generate
Generate report on-demand (EXECUTOR)
- Body: `{ reportType, startDate?, endDate?, formats }`
- Response: `Report` (with URLs once generated)

### GET /api/v1/orgs/:gAddress/reports/:reportId
Retrieve specific report (EXECUTOR+)
- Response: `Report`

### POST /api/v1/orgs/:gAddress/reports/:reportId/resend-email
Resend report via email (EXECUTOR)
- Body: `{ recipients?, formats? }`
- Response: `{ success, deliveryStatus }`

### GET /api/v1/orgs/:gAddress/reports/config
Get report configuration (EXECUTOR+)
- Response: `ReportConfiguration[]`

### PUT /api/v1/orgs/:gAddress/reports/config
Update report configuration (EXECUTOR)
- Body: `ReportConfiguration`
- Response: `ReportConfiguration`

### POST /api/v1/orgs/:gAddress/reports/:reportId/verify
Verify report integrity (EXECUTOR+)
- Response: `{ verified: boolean, signatures: valid[], issues: string[] }`

## Correctness Properties (Property-Based Testing)

**P1:** Report totals match transaction aggregation exactly
**P2:** PDF/Excel export preserves all data without loss
**P3:** Reconciliation discrepancies are always identified
**P4:** Email delivery is idempotent (same report, same email)
**P5:** Report generation is deterministic (same input = same output)
**P6:** Scheduled reports never miss their window
**P7:** Failed reports are retried automatically up to 3 times
**P8:** Reports respect organization data isolation (no cross-org data)
**P9:** Digital signatures verify for all exported formats
**P10:** Storage encryption is transparent to API consumers

## Implementation Phases

**Phase 1 (Days 1-2):** Database schema + ReportGenerationService + ReportFormatterService
**Phase 2 (Days 2-3):** ReportStorageService + API endpoints
**Phase 3 (Days 3-4):** ReportSchedulerService + ReportEmailService
**Phase 4 (Days 4-5):** Testing + security hardening + documentation
