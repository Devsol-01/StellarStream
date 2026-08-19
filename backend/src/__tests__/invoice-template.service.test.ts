import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceTemplateService } from "../services/invoice-template.service.js";
import { prisma } from "../lib/db.js";
import { NotFoundError, ValidationError } from "../lib/app-error.js";

vi.mock("../lib/db.js", () => ({
  prisma: {
    invoiceTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("InvoiceTemplateService", () => {
  let svc: InvoiceTemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new InvoiceTemplateService();
  });

  describe("createTemplate", () => {
    it("creates a non-default template directly", async () => {
      vi.mocked(prisma.invoiceTemplate.create).mockResolvedValue({ id: "tpl_1" } as never);

      const result = await svc.createTemplate({
        ownerAddress: "GOWNER",
        name: "Standard",
      });

      expect(result).toEqual({ id: "tpl_1" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.invoiceTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerAddress: "GOWNER",
          name: "Standard",
          language: "en",
          isDefault: false,
          accentColor: "#00f5ff",
        }),
      });
    });

    it("rejects an invalid accent color", async () => {
      await expect(
        svc.createTemplate({ ownerAddress: "GOWNER", name: "Bad", accentColor: "not-a-color" }),
      ).rejects.toThrow(ValidationError);
      expect(prisma.invoiceTemplate.create).not.toHaveBeenCalled();
    });

    it("unsets the previous default when creating a new default template", async () => {
      const tx = {
        invoiceTemplate: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: "tpl_2", isDefault: true }),
        },
      };
      vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) =>
        cb(tx)) as never);

      const result = await svc.createTemplate({
        ownerAddress: "GOWNER",
        name: "New Default",
        isDefault: true,
      });

      expect(result).toEqual({ id: "tpl_2", isDefault: true });
      expect(tx.invoiceTemplate.updateMany).toHaveBeenCalledWith({
        where: { ownerAddress: "GOWNER", isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe("getTemplate", () => {
    it("throws NotFoundError when missing", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue(null as never);
      await expect(svc.getTemplate("missing")).rejects.toThrow(NotFoundError);
    });

    it("returns the template when found", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({ id: "tpl_1" } as never);
      await expect(svc.getTemplate("tpl_1")).resolves.toEqual({ id: "tpl_1" });
    });
  });

  describe("updateTemplate", () => {
    it("throws NotFoundError when missing", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue(null as never);
      await expect(svc.updateTemplate("missing", { name: "X" })).rejects.toThrow(NotFoundError);
    });

    it("updates fields directly when not touching isDefault", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({
        id: "tpl_1",
        ownerAddress: "GOWNER",
        isDefault: false,
      } as never);
      vi.mocked(prisma.invoiceTemplate.update).mockResolvedValue({ id: "tpl_1", name: "Renamed" } as never);

      const result = await svc.updateTemplate("tpl_1", { name: "Renamed" });
      expect(result).toEqual({ id: "tpl_1", name: "Renamed" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("deleteTemplate", () => {
    it("throws NotFoundError when missing", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue(null as never);
      await expect(svc.deleteTemplate("missing")).rejects.toThrow(NotFoundError);
    });

    it("deletes and returns the prior record", async () => {
      const existing = { id: "tpl_1", name: "Standard" };
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue(existing as never);
      vi.mocked(prisma.invoiceTemplate.delete).mockResolvedValue(existing as never);

      const result = await svc.deleteTemplate("tpl_1");
      expect(result).toEqual(existing);
      expect(prisma.invoiceTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl_1" } });
    });
  });
});
