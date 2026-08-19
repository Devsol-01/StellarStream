import { describe, expect, it } from "vitest";
import { PaymentProofService } from "../services/payment-proof.service.js";

describe("PaymentProofService", () => {
  it("creates and verifies a merkle proof for a payment", async () => {
    const service = new PaymentProofService();

    const proof = await service.createProof({
      id: "payment-1",
      txHash: "tx-123",
      amount: "1000000",
      recipientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      senderAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      asset: "XLM",
      createdAt: "2026-07-22T10:00:00.000Z",
    });

    expect(proof.proofId).toBeTruthy();
    expect(proof.root).toBeTruthy();
    expect(proof.leafHash).toBeTruthy();

    const verification = await service.verifyProof(proof.proofId);
    expect(verification.valid).toBe(true);
    expect(verification.root).toBe(proof.root);
  });

  it("creates batch proofs and verifies each item", async () => {
    const service = new PaymentProofService();

    const proofs = await service.createBatchProofs([
      {
        id: "payment-1",
        txHash: "tx-1",
        amount: "1000",
        recipientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        senderAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        asset: "XLM",
        createdAt: "2026-07-22T10:00:00.000Z",
      },
      {
        id: "payment-2",
        txHash: "tx-2",
        amount: "2000",
        recipientAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        senderAddress: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        asset: "USDC",
        createdAt: "2026-07-22T11:00:00.000Z",
      },
    ]);

    expect(proofs).toHaveLength(2);

    const results = await Promise.all(proofs.map((proof) => service.verifyProof(proof.proofId)));
    expect(results.every((result) => result.valid)).toBe(true);
  });
});
