import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashIP, getTimezoneForCountry } from "../services/geolocation.service.js";

describe("Geolocation utilities", () => {
  describe("hashIP", () => {
    it("should hash IPs consistently for privacy", () => {
      const ip1 = "192.168.1.1";
      const ip2 = "192.168.1.1";
      const ip3 = "10.0.0.1";

      const hash1 = hashIP(ip1);
      const hash2 = hashIP(ip2);
      const hash3 = hashIP(ip3);

      assert.equal(hash1, hash2, "Same IP should produce same hash");
      assert.notEqual(hash1, hash3, "Different IPs should produce different hashes");
      assert.equal(hash1.length, 64, "SHA-256 hash should be 64 hex chars");
    });

    it("should never expose raw IP in hash", () => {
      const ip = "192.168.1.1";
      const hash = hashIP(ip);
      assert.notMatch(hash, /192/, "Should not contain IP parts");
    });
  });

  describe("getTimezoneForCountry", () => {
    it("should return correct timezone for known countries", () => {
      assert.equal(getTimezoneForCountry("US"), "America/New_York");
      assert.equal(getTimezoneForCountry("GB"), "Europe/London");
      assert.equal(getTimezoneForCountry("JP"), "Asia/Tokyo");
      assert.equal(getTimezoneForCountry("AU"), "Australia/Sydney");
    });

    it("should return UTC for unknown countries", () => {
      assert.equal(getTimezoneForCountry("XX"), "UTC");
    });

    it("should be case-insensitive", () => {
      assert.equal(getTimezoneForCountry("us"), "America/New_York");
      assert.equal(getTimezoneForCountry("Us"), "America/New_York");
    });
  });
});