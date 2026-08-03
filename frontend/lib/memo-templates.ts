// frontend/lib/memo-templates.ts
// Issue #1366 — Payment Memo Templates
//
// Domain types, default template library, and variable-substitution logic
// for reusable payment memo text (e.g. Stellar transaction memos, which are
// capped at 28-32 bytes — see StreamMemoInput.tsx).

export type MemoTemplateCategory =
  | "Invoice"
  | "Payroll"
  | "Vendor Payment"
  | "Milestone"
  | "Subscription"
  | "Reimbursement"
  | "Grant"
  | "Bonus"
  | "Refund"
  | "Donation"
  | "General";

export const MEMO_TEMPLATE_CATEGORIES: MemoTemplateCategory[] = [
  "Invoice",
  "Payroll",
  "Vendor Payment",
  "Milestone",
  "Subscription",
  "Reimbursement",
  "Grant",
  "Bonus",
  "Refund",
  "Donation",
  "General",
];

export interface MemoTemplate {
  id: string;
  name: string;
  category: MemoTemplateCategory;
  /** Template text containing `{{variableName}}` placeholders. */
  body: string;
  /** Built-in templates ship read-only; users duplicate them to customize. */
  isDefault: boolean;
  usageCount: number;
  createdAt: string;
}

/** A variable reference known to the picker UI, e.g. `{{invoiceNumber}}`. */
export interface MemoVariable {
  key: string;
  label: string;
  example: string;
}

export const MEMO_VARIABLES: MemoVariable[] = [
  { key: "invoiceNumber", label: "Invoice Number", example: "INV-2026-045" },
  { key: "recipientName", label: "Recipient Name", example: "Jane Doe" },
  { key: "senderName", label: "Sender Name", example: "Acme Inc" },
  { key: "amount", label: "Amount", example: "500" },
  { key: "asset", label: "Asset", example: "USDC" },
  { key: "date", label: "Date", example: "2026-07-24" },
  { key: "period", label: "Period", example: "July 2026" },
  { key: "milestoneName", label: "Milestone Name", example: "Q3 Launch" },
  { key: "referenceId", label: "Reference ID", example: "REF-8842" },
];

// ─── Default template library (≥ 10, per acceptance criteria) ───────────────

export const DEFAULT_MEMO_TEMPLATES: MemoTemplate[] = [
  {
    id: "default-invoice-payment",
    name: "Invoice Payment",
    category: "Invoice",
    body: "Invoice {{invoiceNumber}} - {{amount}} {{asset}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-payroll",
    name: "Payroll Run",
    category: "Payroll",
    body: "Payroll {{period}} - {{recipientName}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-vendor-payment",
    name: "Vendor Payment",
    category: "Vendor Payment",
    body: "Vendor payment {{referenceId}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-milestone",
    name: "Milestone Payment",
    category: "Milestone",
    body: "Milestone: {{milestoneName}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-subscription-renewal",
    name: "Subscription Renewal",
    category: "Subscription",
    body: "Subscription renewal {{period}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-reimbursement",
    name: "Expense Reimbursement",
    category: "Reimbursement",
    body: "Reimbursement {{referenceId}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-grant",
    name: "Grant Disbursement",
    category: "Grant",
    body: "Grant disbursement {{date}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-bonus",
    name: "Bonus Payment",
    category: "Bonus",
    body: "Bonus {{period}} - {{recipientName}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-refund",
    name: "Refund",
    category: "Refund",
    body: "Refund for {{referenceId}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-donation",
    name: "Donation",
    category: "Donation",
    body: "Donation from {{senderName}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "default-general-payment",
    name: "General Payment",
    category: "General",
    body: "Payment: {{referenceId}}",
    isDefault: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

// ─── Variable substitution ───────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Returns the ordered, de-duplicated list of variable keys a template body
 * references, e.g. "Invoice {{invoiceNumber}}" -> ["invoiceNumber"].
 */
export function extractVariables(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1];
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * Replaces `{{key}}` placeholders with the matching value from `values`.
 * Placeholders with no provided value (missing key, or blank/whitespace-only
 * value) are left in place so the caller can see what's still unfilled.
 */
export function substituteVariables(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = values[key];
    return value && value.trim() ? value.trim() : match;
  });
}

/** True once every placeholder in `body` has been replaced by substituteVariables. */
export function isFullySubstituted(body: string): boolean {
  // Uses extractVariables (matchAll, which doesn't mutate PLACEHOLDER_RE's
  // lastIndex) rather than PLACEHOLDER_RE.test() directly — a shared global
  // regex's lastIndex persists between .test() calls, which would make this
  // give wrong answers on repeated calls.
  return extractVariables(body).length === 0;
}
