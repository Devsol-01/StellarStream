import { Horizon } from "@stellar/stellar-sdk";
import { PrismaClient } from "../generated/client/client.js";
import { logger } from "../logger.js";

interface LedgerMismatch {
  sequence: number;
  stored: string;
  actual: string;
}

export interface VerificationResult {
  verified: boolean;
  mismatches: LedgerMismatch[];
}

export class LedgerVerificationService {
  private horizon: Horizon.Server;
  private prisma: PrismaClient;

  constructor(horizon: Horizon.Server, prisma: PrismaClient) {
    this.horizon = horizon;
    this.prisma = prisma;
  }

  async verifyLedgers(
    fromSequence: number,
    toSequence: number
  ): Promise<VerificationResult> {
    const storedHashes = await this.prisma.ledgerHash.findMany({
      where: {
        sequence: { gte: fromSequence, lte: toSequence },
      },
      orderBy: { sequence: "asc" },
    });

    if (storedHashes.length === 0) {
      logger.debug("No stored ledger hashes in range to verify", {
        fromSequence,
        toSequence,
      });
      return { verified: true, mismatches: [] };
    }

    const mismatches: LedgerMismatch[] = [];

    for (const stored of storedHashes) {
      try {
        const ledgerRecord = await this.horizon
          .ledgers()
          .ledger(stored.sequence)
          .call();

        if (ledgerRecord.hash !== stored.hash) {
          mismatches.push({
            sequence: stored.sequence,
            stored: stored.hash,
            actual: ledgerRecord.hash,
          });
        }
      } catch (error) {
        logger.warn("Failed to fetch ledger from Horizon for verification", {
          sequence: stored.sequence,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      verified: mismatches.length === 0,
      mismatches,
    };
  }
}
