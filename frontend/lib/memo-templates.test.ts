import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMO_TEMPLATES,
  MEMO_TEMPLATE_CATEGORIES,
  extractVariables,
  substituteVariables,
  isFullySubstituted,
} from "@/lib/memo-templates";

describe("memo-templates", () => {
  describe("default template library", () => {
    it("ships at least 10 default templates", () => {
      expect(DEFAULT_MEMO_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    });

    it("marks every default template as isDefault", () => {
      expect(DEFAULT_MEMO_TEMPLATES.every((t) => t.isDefault)).toBe(true);
    });

    it("gives every default template a unique id", () => {
      const ids = DEFAULT_MEMO_TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("only uses categories from MEMO_TEMPLATE_CATEGORIES", () => {
      for (const t of DEFAULT_MEMO_TEMPLATES) {
        expect(MEMO_TEMPLATE_CATEGORIES).toContain(t.category);
      }
    });

    it("gives every default template at least one variable placeholder", () => {
      for (const t of DEFAULT_MEMO_TEMPLATES) {
        expect(extractVariables(t.body).length).toBeGreaterThan(0);
      }
    });
  });

  describe("extractVariables", () => {
    it("extracts a single placeholder", () => {
      expect(extractVariables("Invoice {{invoiceNumber}}")).toEqual(["invoiceNumber"]);
    });

    it("extracts multiple distinct placeholders in order", () => {
      expect(extractVariables("{{a}} then {{b}} then {{a}}")).toEqual(["a", "b"]);
    });

    it("returns an empty array when there are no placeholders", () => {
      expect(extractVariables("Plain memo text")).toEqual([]);
    });

    it("tolerates whitespace inside braces", () => {
      expect(extractVariables("{{ amount }}")).toEqual(["amount"]);
    });
  });

  describe("substituteVariables", () => {
    it("replaces a single known variable", () => {
      expect(substituteVariables("Invoice {{invoiceNumber}}", { invoiceNumber: "INV-1" })).toBe(
        "Invoice INV-1",
      );
    });

    it("replaces multiple variables", () => {
      const result = substituteVariables("{{amount}} {{asset}}", { amount: "500", asset: "USDC" });
      expect(result).toBe("500 USDC");
    });

    it("trims whitespace from provided values", () => {
      expect(substituteVariables("{{name}}", { name: "  Jane  " })).toBe("Jane");
    });

    it("leaves a placeholder untouched when no value is provided", () => {
      expect(substituteVariables("Invoice {{invoiceNumber}}", {})).toBe("Invoice {{invoiceNumber}}");
    });

    it("leaves a placeholder untouched when the provided value is blank", () => {
      expect(substituteVariables("{{name}}", { name: "   " })).toBe("{{name}}");
    });

    it("is a no-op on text with no placeholders", () => {
      expect(substituteVariables("Plain memo", { unused: "x" })).toBe("Plain memo");
    });
  });

  describe("isFullySubstituted", () => {
    it("is true when no placeholders remain", () => {
      expect(isFullySubstituted("Invoice INV-1")).toBe(true);
    });

    it("is false when a placeholder remains", () => {
      expect(isFullySubstituted("Invoice {{invoiceNumber}}")).toBe(false);
    });

    it("gives consistent answers across repeated calls (no shared regex state)", () => {
      // Regression check: a naive implementation using a shared global
      // RegExp's .test() would give different answers on repeated calls
      // because .test() mutates the regex's lastIndex.
      const withPlaceholder = "{{a}}";
      const without = "plain text";
      expect(isFullySubstituted(withPlaceholder)).toBe(false);
      expect(isFullySubstituted(without)).toBe(true);
      expect(isFullySubstituted(withPlaceholder)).toBe(false);
      expect(isFullySubstituted(without)).toBe(true);
    });
  });
});
