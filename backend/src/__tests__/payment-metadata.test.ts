import { describe, it, expect } from "vitest";
import {
  validateMetadataPairs,
  mergeInherited,
  KEY_PATTERN,
  MAX_VALUE_LENGTH,
  MAX_PAIRS_PER_ENTITY,
  type MetadataPair,
} from "../services/payment-metadata.service.js";

// ═══════════════════════════════════════════════════════════════
// PaymentMetadataService — pure logic (no DB dependency)
// ═══════════════════════════════════════════════════════════════

describe("PaymentMetadataService", () => {
  describe("validateMetadataPairs", () => {
    it("accepts valid keys and values", () => {
      const pairs: MetadataPair[] = [
        { key: "invoice", value: "INV-001" },
        { key: "priority.level", value: "high" },
        { key: "cost_center-42", value: "" },
      ];
      expect(() => validateMetadataPairs(pairs)).not.toThrow();
    });

    it("rejects keys with invalid characters", () => {
      expect(() =>
        validateMetadataPairs([{ key: "bad key!", value: "x" }]),
      ).toThrow(/Invalid metadata key/);
      expect(() =>
        validateMetadataPairs([{ key: "space bar", value: "x" }]),
      ).toThrow(/Invalid metadata key/);
    });

    it("rejects an empty key", () => {
      expect(() =>
        validateMetadataPairs([{ key: "", value: "x" }]),
      ).toThrow(/Invalid metadata key/);
    });

    it("rejects a key longer than 64 chars", () => {
      const longKey = "k".repeat(65);
      expect(KEY_PATTERN.test(longKey)).toBe(false);
      expect(() =>
        validateMetadataPairs([{ key: longKey, value: "x" }]),
      ).toThrow(/Invalid metadata key/);
    });

    it("rejects a value longer than MAX_VALUE_LENGTH", () => {
      const longValue = "v".repeat(MAX_VALUE_LENGTH + 1);
      expect(() =>
        validateMetadataPairs([{ key: "note", value: longValue }]),
      ).toThrow(/Invalid value for key/);
    });

    it("accepts a value exactly at MAX_VALUE_LENGTH", () => {
      const value = "v".repeat(MAX_VALUE_LENGTH);
      expect(() => validateMetadataPairs([{ key: "note", value }])).not.toThrow();
    });

    it("rejects more than MAX_PAIRS_PER_ENTITY pairs", () => {
      const pairs: MetadataPair[] = Array.from(
        { length: MAX_PAIRS_PER_ENTITY + 1 },
        (_, i) => ({ key: `k${i}`, value: "v" }),
      );
      expect(() => validateMetadataPairs(pairs)).toThrow(/Too many metadata pairs/);
    });

    it("rejects duplicate keys within a set", () => {
      expect(() =>
        validateMetadataPairs([
          { key: "dup", value: "a" },
          { key: "dup", value: "b" },
        ]),
      ).toThrow(/Duplicate metadata key/);
    });
  });

  describe("mergeInherited", () => {
    it("returns inherited pairs flagged as inherited when there is no override", () => {
      const merged = mergeInherited(
        [{ key: "team", value: "growth" }],
        [],
      );
      expect(merged).toEqual([{ key: "team", value: "growth", inherited: true }]);
    });

    it("returns own pairs flagged as not inherited", () => {
      const merged = mergeInherited([], [{ key: "note", value: "hi" }]);
      expect(merged).toEqual([{ key: "note", value: "hi", inherited: false }]);
    });

    it("lets entity-level pairs override inherited pairs on key collision", () => {
      const merged = mergeInherited(
        [{ key: "team", value: "growth" }],
        [{ key: "team", value: "platform" }],
      );
      const team = merged.find((p) => p.key === "team");
      expect(team?.value).toBe("platform");
      expect(team?.inherited).toBe(false);
      expect(merged.length).toBe(1);
    });

    it("combines distinct inherited and own keys", () => {
      const merged = mergeInherited(
        [{ key: "team", value: "growth" }],
        [{ key: "note", value: "hi" }],
      );
      expect(merged.length).toBe(2);
      const byKey = Object.fromEntries(merged.map((p) => [p.key, p]));
      expect(byKey.team.inherited).toBe(true);
      expect(byKey.note.inherited).toBe(false);
    });
  });
});
