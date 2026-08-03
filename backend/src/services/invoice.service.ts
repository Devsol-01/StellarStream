import { prisma } from "../lib/db.js";
import { NotFoundError, BusinessRuleError, ValidationError } from "../lib/app-error.js";
import { generateInvoiceNumber } from "./invoice-numbering.service.js";
import { calculateInvoiceSubtotal, calculateInvoiceTax } from "./invoice-tax.service.js";
import { generateInvoicePDF, type InvoiceReportData } from "./invoice-pdf.service.js";
import { InvoiceTemplateService } from "./invoice-template.service.js";
import type { SupportedLanguage } from "../i18n/error-localization.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export interface InvoiceRecipientInput {
  address: string;
  amount: string;
  label?: string;
}

export interface CreateInvoiceInput {
  ownerAddress: string;
  sender: string;
  asset: string;
  recipients: InvoiceRecipientInput[];
  taxRate?: number;
  language?: SupportedLanguage;
  templateId?: string;
  disbursementId?: string;
  note?: string;
  txHash?: string;
  dueAt?: string;
}

export interface InvoiceFilter {
  ownerAddress: string;
  status?: InvoiceStatusValue;
}

/**
 * Valid forward transitions for the invoice lifecycle. DRAFT is the
 * created-but-unsent state; ISSUED means the PDF has gone out to the payer;
 * PAID/VOID are terminal.
 */
export const ALLOWED_INVOICE_TRANSITIONS: Record<
  InvoiceStatusValue,
  readonly InvoiceStatusValue[]
> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["PAID", "VOID"],
  PAID: [],
  VOID: [],
};

/** Pure check (no DB) so the state machine can be unit-tested directly. */
export function isValidInvoiceTransition(
  from: InvoiceStatusValue,
  to: InvoiceStatusValue,
): boolean {
  return ALLOWED_INVOICE_TRANSITIONS[from].includes(to);
}

export class InvoiceService {
  private templateService = new InvoiceTemplateService();

  // ── Create ───────────────────────────────────────────────────────────────

  async createInvoice(input: CreateInvoiceInput) {
    const taxRate = input.taxRate ?? 0;
    const subtotal = calculateInvoiceSubtotal(input.recipients);
    const { taxAmount, totalAmount } = calculateInvoiceTax(subtotal, taxRate);

    const template = input.templateId
      ? await this.templateService.getTemplate(input.templateId)
      : await this.templateService.getDefaultTemplate(input.ownerAddress);

    const language = input.language ?? (template?.language as SupportedLanguage | undefined) ?? "en";
    const invoiceNumber = await generateInvoiceNumber(input.ownerAddress);

    return prisma.invoice.create({
      data: {
        invoiceNumber,
        ownerAddress: input.ownerAddress,
        disbursementId: input.disbursementId,
        templateId: template?.id,
        language,
        sender: input.sender,
        asset: input.asset,
        recipients: input.recipients as never,
        subtotal,
        taxRate,
        taxAmount,
        totalAmount,
        note: input.note,
        txHash: input.txHash,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      include: { template: true },
    });
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async getInvoice(id: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!invoice) throw new NotFoundError("Invoice", id);
    return invoice;
  }

  async listInvoices(filter: InvoiceFilter) {
    if (!filter.ownerAddress) {
      throw new ValidationError("ownerAddress is required");
    }
    return prisma.invoice.findMany({
      where: {
        ownerAddress: filter.ownerAddress,
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { template: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── Status transitions ──────────────────────────────────────────────────

  async updateInvoiceStatus(id: string, nextStatus: InvoiceStatusValue) {
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundError("Invoice", id);

    const currentStatus = invoice.status as InvoiceStatusValue;
    if (!isValidInvoiceTransition(currentStatus, nextStatus)) {
      throw new BusinessRuleError(
        `Invalid invoice status transition: ${currentStatus} -> ${nextStatus}`,
        { details: { from: currentStatus, to: nextStatus } },
      );
    }

    return prisma.invoice.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === "ISSUED" ? { issuedAt: new Date() } : {}),
      },
      include: { template: true },
    });
  }

  // ── PDF rendering ────────────────────────────────────────────────────────

  async renderInvoicePdf(id: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const invoice = await this.getInvoice(id);
    const recipients = invoice.recipients as unknown as InvoiceRecipientInput[];

    const reportData: InvoiceReportData = {
      orgName: invoice.sender,
      logoBase64: invoice.template?.logoBase64 ?? undefined,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: (invoice.issuedAt ?? invoice.createdAt).toISOString(),
      asset: invoice.asset,
      sender: invoice.sender,
      recipients,
      totalAmount: invoice.totalAmount,
      txHash: invoice.txHash ?? undefined,
      note: invoice.note ?? undefined,
      language: invoice.language as SupportedLanguage,
      subtotal: invoice.subtotal,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      accentColor: invoice.template?.accentColor,
      footerText: invoice.template?.footerText ?? undefined,
    };

    const buffer = await generateInvoicePDF(reportData);
    return { buffer, invoiceNumber: invoice.invoiceNumber };
  }
}
