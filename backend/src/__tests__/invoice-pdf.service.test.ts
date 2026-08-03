import { describe, it, expect } from "vitest";
import { generateInvoicePDF, type InvoiceReportData } from "../services/invoice-pdf.service.js";

const BASE: InvoiceReportData = {
  orgName: "Acme Org",
  invoiceNumber: "INV-2026-000001",
  issuedAt: "2026-07-25T00:00:00.000Z",
  asset: "USDC",
  sender: "Acme Org",
  recipients: [
    { address: "GRECEIVER1", amount: "60", label: "Contractor A" },
    { address: "GRECEIVER2", amount: "40" },
  ],
  totalAmount: "100",
};

describe("invoice-pdf.service", () => {
  it("resolves a valid PDF buffer for the minimal (backward-compatible) shape", async () => {
    const buffer = await generateInvoicePDF(BASE);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it.each(["en", "ar", "fr", "es"] as const)(
    "resolves a valid PDF with a tax breakdown for language=%s",
    async (language) => {
      const buffer = await generateInvoicePDF({
        ...BASE,
        language,
        subtotal: "90",
        taxRate: 11.11,
        taxAmount: "10",
        totalAmount: "100",
      });
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    },
  );

  it("resolves a valid PDF with template accent color / footer overrides", async () => {
    const buffer = await generateInvoicePDF({
      ...BASE,
      accentColor: "#ff00aa",
      footerText: "Custom footer generated {date}",
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("resolves a valid PDF with a tx hash and note present", async () => {
    const buffer = await generateInvoicePDF({
      ...BASE,
      txHash: "a".repeat(64),
      note: "Thank you for your business.",
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
