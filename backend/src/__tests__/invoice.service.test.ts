import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvoiceService,
  ALLOWED_INVOICE_TRANSITIONS,
  INVOICE_STATUSES,
  isValidInvoiceTransition,
} from "../services/invoice.service.js";
import { prisma } from "../lib/db.js";
import { NotFoundError, BusinessRuleError, ValidationError } from "../lib/app-error.js";

vi.mock("../lib/db.js", () => ({
  prisma: {
    invoice: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    invoiceTemplate: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

const generateInvoiceNumberMock = vi.fn();
vi.mock("../services/invoice-numbering.service.js", () => ({
  generateInvoiceNumber: (...args: unknown[]) => generateInvoiceNumberMock(...args),
}));

const generatePdfMock = vi.fn();
vi.mock("../services/invoice-pdf.service.js", () => ({
  generateInvoicePDF: (...args: unknown[]) => generatePdfMock(...args),
}));

// ═══════════════════════════════════════════════════════════════
// Invoice state machine — pure logic (no DB dependency)
// ═══════════════════════════════════════════════════════════════

describe("invoice status state machine", () => {
  it("covers every declared status in ALLOWED_INVOICE_TRANSITIONS", () => {
    for (const status of INVOICE_STATUSES) {
      expect(ALLOWED_INVOICE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("allows the documented happy path", () => {
    expect(isValidInvoiceTransition("DRAFT", "ISSUED")).toBe(true);
    expect(isValidInvoiceTransition("ISSUED", "PAID")).toBe(true);
  });

  it("allows voiding from DRAFT or ISSUED", () => {
    expect(isValidInvoiceTransition("DRAFT", "VOID")).toBe(true);
    expect(isValidInvoiceTransition("ISSUED", "VOID")).toBe(true);
  });

  it("rejects skipping straight to PAID", () => {
    expect(isValidInvoiceTransition("DRAFT", "PAID")).toBe(false);
  });

  it("treats PAID and VOID as terminal", () => {
    expect(ALLOWED_INVOICE_TRANSITIONS.PAID).toHaveLength(0);
    expect(ALLOWED_INVOICE_TRANSITIONS.VOID).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// InvoiceService — DB-backed behavior (mocked prisma)
// ═══════════════════════════════════════════════════════════════

describe("InvoiceService", () => {
  let svc: InvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new InvoiceService();
  });

  describe("createInvoice", () => {
    it("computes subtotal/tax/total, allocates a number, and persists a DRAFT invoice", async () => {
      vi.mocked(prisma.invoiceTemplate.findFirst).mockResolvedValue(null as never);
      generateInvoiceNumberMock.mockResolvedValue("INV-2026-000001");
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv_1" } as never);

      const result = await svc.createInvoice({
        ownerAddress: "GOWNER",
        sender: "Acme Org",
        asset: "USDC",
        recipients: [{ address: "GRECEIVER", amount: "100" }],
        taxRate: 10,
      });

      expect(result).toEqual({ id: "inv_1" });
      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceNumber: "INV-2026-000001",
          ownerAddress: "GOWNER",
          subtotal: "100",
          taxRate: 10,
          taxAmount: "10",
          totalAmount: "110",
          language: "en",
        }),
        include: { template: true },
      });
    });

    it("uses the explicit templateId over the owner's default template", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({
        id: "tpl_1",
        language: "fr",
      } as never);
      generateInvoiceNumberMock.mockResolvedValue("INV-2026-000002");
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv_2" } as never);

      await svc.createInvoice({
        ownerAddress: "GOWNER",
        sender: "Acme Org",
        asset: "USDC",
        recipients: [{ address: "GRECEIVER", amount: "50" }],
        templateId: "tpl_1",
      });

      expect(prisma.invoiceTemplate.findUnique).toHaveBeenCalledWith({ where: { id: "tpl_1" } });
      expect(prisma.invoiceTemplate.findFirst).not.toHaveBeenCalled();
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: "tpl_1", language: "fr" }),
        }),
      );
    });

    it("rejects when recipients is empty", async () => {
      await expect(
        svc.createInvoice({
          ownerAddress: "GOWNER",
          sender: "Acme Org",
          asset: "USDC",
          recipients: [],
        }),
      ).rejects.toThrow(ValidationError);
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe("getInvoice", () => {
    it("throws NotFoundError when missing", async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
      await expect(svc.getInvoice("missing")).rejects.toThrow(NotFoundError);
    });
  });

  describe("listInvoices", () => {
    it("requires ownerAddress", async () => {
      await expect(svc.listInvoices({ ownerAddress: "" })).rejects.toThrow(ValidationError);
    });

    it("filters by status when provided", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
      await svc.listInvoices({ ownerAddress: "GOWNER", status: "ISSUED" });
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerAddress: "GOWNER", status: "ISSUED" },
        }),
      );
    });
  });

  describe("updateInvoiceStatus", () => {
    it("throws NotFoundError when missing", async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
      await expect(svc.updateInvoiceStatus("missing", "ISSUED")).rejects.toThrow(NotFoundError);
    });

    it("rejects an invalid transition", async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv_1", status: "DRAFT" } as never);
      await expect(svc.updateInvoiceStatus("inv_1", "PAID")).rejects.toThrow(BusinessRuleError);
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it("sets issuedAt when transitioning to ISSUED", async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv_1", status: "DRAFT" } as never);
      vi.mocked(prisma.invoice.update).mockResolvedValue({ id: "inv_1", status: "ISSUED" } as never);

      await svc.updateInvoiceStatus("inv_1", "ISSUED");

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "inv_1" },
          data: expect.objectContaining({ status: "ISSUED", issuedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe("renderInvoicePdf", () => {
    it("maps the persisted invoice into InvoiceReportData and renders a PDF", async () => {
      const createdAt = new Date("2026-07-20T00:00:00.000Z");
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv_1",
        invoiceNumber: "INV-2026-000001",
        sender: "Acme Org",
        asset: "USDC",
        recipients: [{ address: "GRECEIVER", amount: "100" }],
        subtotal: "100",
        taxRate: 10,
        taxAmount: "10",
        totalAmount: "110",
        note: null,
        txHash: null,
        language: "en",
        issuedAt: null,
        createdAt,
        template: null,
      } as never);
      generatePdfMock.mockResolvedValue(Buffer.from("%PDF-fake"));

      const result = await svc.renderInvoicePdf("inv_1");

      expect(result.invoiceNumber).toBe("INV-2026-000001");
      expect(result.buffer.toString()).toContain("%PDF");
      expect(generatePdfMock).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceNumber: "INV-2026-000001",
          subtotal: "100",
          taxAmount: "10",
          totalAmount: "110",
          issuedAt: createdAt.toISOString(),
        }),
      );
    });
  });
});
