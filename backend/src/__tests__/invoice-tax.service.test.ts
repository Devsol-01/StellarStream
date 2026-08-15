import { describe, it, expect } from "vitest";
import {
  parseAmount,
  formatAmount,
  calculateInvoiceSubtotal,
  calculateInvoiceTax,
} from "../services/invoice-tax.service.js";
import { ValidationError } from "../lib/app-error.js";

describe("invoice-tax.service", () => {
  describe("parseAmount / formatAmount", () => {
    it("round-trips whole numbers", () => {
      expect(formatAmount(parseAmount("100"))).toBe("100");
    });

    it("round-trips decimals and trims trailing zeros", () => {
      expect(formatAmount(parseAmount("100.500000"))).toBe("100.5");
      expect(formatAmount(parseAmount("0.0000001"))).toBe("0.0000001");
    });

    it("rejects malformed amounts", () => {
      expect(() => parseAmount("abc")).toThrow(ValidationError);
      expect(() => parseAmount("-5")).toThrow(ValidationError);
      expect(() => parseAmount("5.")).toThrow(ValidationError);
    });

    it("rejects amounts with more than 7 decimal places", () => {
      expect(() => parseAmount("1.00000001")).toThrow(ValidationError);
    });

    it("rejects negative scaled amounts on format", () => {
      expect(() => formatAmount(-1n)).toThrow(ValidationError);
    });
  });

  describe("calculateInvoiceSubtotal", () => {
    it("sums recipient amounts", () => {
      const subtotal = calculateInvoiceSubtotal([
        { amount: "100.25" },
        { amount: "50" },
        { amount: "0.75" },
      ]);
      expect(subtotal).toBe("151");
    });

    it("throws when there are no recipients", () => {
      expect(() => calculateInvoiceSubtotal([])).toThrow(ValidationError);
    });

    it("throws when a recipient amount is zero or negative", () => {
      expect(() => calculateInvoiceSubtotal([{ amount: "0" }])).toThrow(ValidationError);
    });
  });

  describe("calculateInvoiceTax", () => {
    it("computes zero tax at a 0% rate", () => {
      const result = calculateInvoiceTax("100", 0);
      expect(result).toEqual({ taxAmount: "0", totalAmount: "100" });
    });

    it("computes tax at a typical flat rate", () => {
      const result = calculateInvoiceTax("100", 10);
      expect(result).toEqual({ taxAmount: "10", totalAmount: "110" });
    });

    it("computes tax at a fractional rate with correct rounding", () => {
      const result = calculateInvoiceTax("200", 7.25);
      expect(result).toEqual({ taxAmount: "14.5", totalAmount: "214.5" });
    });

    it("rounds half-up to the nearest 0.0000001", () => {
      // True tax = 0.0000003 * 0.5 = 0.00000015, which is exactly halfway
      // between 0.0000001 and 0.0000002 at 7-decimal precision.
      const result = calculateInvoiceTax("0.0000003", 50);
      expect(result).toEqual({ taxAmount: "0.0000002", totalAmount: "0.0000005" });
    });

    it("rejects a tax rate below 0 or above 100", () => {
      expect(() => calculateInvoiceTax("100", -1)).toThrow(ValidationError);
      expect(() => calculateInvoiceTax("100", 100.01)).toThrow(ValidationError);
    });

    it("rejects a non-finite tax rate", () => {
      expect(() => calculateInvoiceTax("100", Number.NaN)).toThrow(ValidationError);
    });
  });
});
