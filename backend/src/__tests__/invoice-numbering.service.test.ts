import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatInvoiceNumber,
  generateInvoiceNumber,
} from "../services/invoice-numbering.service.js";
import { prisma } from "../lib/db.js";
import { InternalError } from "../lib/app-error.js";

vi.mock("../lib/db.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe("invoice-numbering.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatInvoiceNumber", () => {
    it("pads the sequence to 6 digits", () => {
      expect(formatInvoiceNumber(2026, 42)).toBe("INV-2026-000042");
    });

    it("does not truncate sequences longer than 6 digits", () => {
      expect(formatInvoiceNumber(2026, 1234567)).toBe("INV-2026-1234567");
    });
  });

  describe("generateInvoiceNumber", () => {
    it("formats the number from the atomically-allocated sequence", async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastSeq: 1 }] as never);

      const result = await generateInvoiceNumber("GOWNER", new Date("2026-07-25T00:00:00.000Z"));
      expect(result).toBe("INV-2026-000001");
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("increments across successive calls", async () => {
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([{ lastSeq: 1 }] as never)
        .mockResolvedValueOnce([{ lastSeq: 2 }] as never);

      const first = await generateInvoiceNumber("GOWNER", new Date("2026-07-25T00:00:00.000Z"));
      const second = await generateInvoiceNumber("GOWNER", new Date("2026-07-25T00:00:00.000Z"));

      expect(first).toBe("INV-2026-000001");
      expect(second).toBe("INV-2026-000002");
    });

    it("throws InternalError when no row is returned", async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

      await expect(
        generateInvoiceNumber("GOWNER", new Date("2026-07-25T00:00:00.000Z")),
      ).rejects.toThrow(InternalError);
    });
  });
});
