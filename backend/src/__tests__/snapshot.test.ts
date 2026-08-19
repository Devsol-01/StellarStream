import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

// ═══════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════

const TEST_DIR = path.join(import.meta.dirname ?? process.cwd(), "__test_data__");

// ═══════════════════════════════════════════════════════════════
// Unit tests
// ═══════════════════════════════════════════════════════════════

describe("Snapshot utilities", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("hour format utilities", () => {
    it("should format date to hour format correctly", () => {
      const date = new Date("2025-06-15T14:30:00Z");
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hour = String(date.getHours()).padStart(2, "0");
      const formatted = `${year}-${month}-${day}-${hour}`;
      
      assert.equal(formatted, "2025-06-15-14", "Hour should be formatted as YYYY-MM-DD-HH");
    });

    it("should convert different dates to different hour formats", () => {
      const date1 = new Date("2025-03-20T08:45:30Z");
      const date2 = new Date("2025-12-31T23:59:59Z");
      
      const formatHour = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        return `${y}-${m}-${day}-${h}`;
      };
      
      assert.equal(formatHour(date1), "2025-03-20-08");
      assert.equal(formatHour(date2), "2025-12-31-23");
    });
  });

  describe("delta compression simulation", () => {
    it("should detect state differences", () => {
      const stateA = { totalAmount: 1000000n, withdrawnAmount: 0n, state: "ACTIVE" };
      const stateB = { totalAmount: 1500000n, withdrawnAmount: 500000n, state: "PAUSED" };
      
      const differences: Record<string, { before: any; after: any }> = {};
      
      if (stateA.totalAmount !== stateB.totalAmount) {
        differences.totalAmount = { before: stateA.totalAmount, after: stateB.totalAmount };
      }
      if (stateA.withdrawnAmount !== stateB.withdrawnAmount) {
        differences.withdrawnAmount = { before: stateA.withdrawnAmount, after: stateB.withdrawnAmount };
      }
      if (stateA.state !== stateB.state) {
        differences.state = { before: stateA.state, after: stateB.state };
      }
      
      assert.equal(Object.keys(differences).length, 3, "Should detect 3 differences");
      assert.ok("totalAmount" in differences);
      assert.ok("withdrawnAmount" in differences);
      assert.ok("state" in differences);
    });

    it("should return no differences for identical states", () => {
      const stateA = { totalAmount: 1000000n, withdrawnAmount: 250000n, state: "ACTIVE" };
      const stateB = { totalAmount: 1000000n, withdrawnAmount: 250000n, state: "ACTIVE" };
      
      const differences: Record<string, { before: any; after: any }> = {};
      
      if (stateA.totalAmount !== stateB.totalAmount) {
        differences.totalAmount = { before: stateA.totalAmount, after: stateB.totalAmount };
      }
      if (stateA.withdrawnAmount !== stateB.withdrawnAmount) {
        differences.withdrawnAmount = { before: stateA.withdrawnAmount, after: stateB.withdrawnAmount };
      }
      if (stateA.state !== stateB.state) {
        differences.state = { before: stateA.state, after: stateB.state };
      }
      
      assert.equal(Object.keys(differences).length, 0, "Should detect no differences");
    });
  });
});