import express from "express";
import request from "supertest";
import paymentProofRouter from "../api/v3/payment-proof.routes.js";

describe("payment proof routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v3", paymentProofRouter);

  it("creates a proof via the public route", async () => {
    const res = await request(app).post("/api/v3/public/payments/proofs").send({
      id: "p-1",
      txHash: "tx-1",
      amount: "1000",
      recipientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      senderAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      asset: "XLM",
      createdAt: "2026-07-22T10:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.root).toBeTruthy();
  });

  it("verifies a proof via the public route", async () => {
    const createRes = await request(app).post("/api/v3/public/payments/proofs").send({
      id: "p-2",
      txHash: "tx-2",
      amount: "2000",
      recipientAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      senderAddress: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      asset: "USDC",
      createdAt: "2026-07-22T11:00:00.000Z",
    });

    const proofId = createRes.body.data.proofId;
    const verifyRes = await request(app).post("/api/v3/public/payments/proofs/verify").send({ proofId });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.valid).toBe(true);
  });
});
