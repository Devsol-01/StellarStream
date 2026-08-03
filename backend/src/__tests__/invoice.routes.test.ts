import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../middleware/errorHandler.js";
import { prisma } from "../lib/db.js";

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
    $queryRaw: vi.fn(),
  },
}));

const OWNER = `G${"A".repeat(55)}`;
const RECEIVER = `G${"B".repeat(55)}`;

async function loadApp() {
  const { default: invoiceRouter } = await import("../api/v3/invoice.routes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/v3", invoiceRouter);
  app.use(errorHandler);
  return app;
}

describe("invoice routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an invoice with computed tax/total", async () => {
    const app = await loadApp();
    vi.mocked(prisma.invoiceTemplate.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastSeq: 1 }] as never);
    vi.mocked(prisma.invoice.create).mockImplementation(
      (args: any) => Promise.resolve({ id: "inv_1", ...args.data }) as never,
    );

    const res = await request(app)
      .post("/api/v3/invoices")
      .send({
        ownerAddress: OWNER,
        sender: "Acme Org",
        asset: "USDC",
        recipients: [{ address: RECEIVER, amount: "100" }],
        taxRate: 10,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subtotal).toBe("100");
    expect(res.body.data.taxAmount).toBe("10");
    expect(res.body.data.totalAmount).toBe("110");
    expect(res.body.data.invoiceNumber).toMatch(
      new RegExp(`^INV-${new Date().getUTCFullYear()}-\\d{6}$`),
    );
  });

  it("rejects invoice creation with no recipients", async () => {
    const app = await loadApp();

    const res = await request(app)
      .post("/api/v3/invoices")
      .send({ ownerAddress: OWNER, sender: "Acme Org", asset: "USDC", recipients: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing invoice", async () => {
    const app = await loadApp();
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);

    const res = await request(app).get("/api/v3/invoices/ckvalidcuid0000000000000");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("ERR_NOT_FOUND");
  });

  it("rejects an invalid status transition with 422", async () => {
    const app = await loadApp();
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "ckvalidcuid0000000000000",
      status: "DRAFT",
    } as never);

    const res = await request(app)
      .patch("/api/v3/invoices/ckvalidcuid0000000000000/status")
      .send({ status: "PAID" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("streams a PDF for /invoices/:id/pdf", async () => {
    const app = await loadApp();
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "ckvalidcuid0000000000000",
      invoiceNumber: "INV-2026-000001",
      sender: "Acme Org",
      asset: "USDC",
      recipients: [{ address: RECEIVER, amount: "100" }],
      subtotal: "100",
      taxRate: 0,
      taxAmount: "0",
      totalAmount: "100",
      note: null,
      txHash: null,
      language: "en",
      issuedAt: null,
      createdAt: new Date(),
      template: null,
    } as never);

    const res = await request(app).get("/api/v3/invoices/ckvalidcuid0000000000000/pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
  });
});
