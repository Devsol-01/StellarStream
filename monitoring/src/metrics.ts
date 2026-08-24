import { PrismaClient } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config, CONTRACT_IDS } from "./config";

const prisma = new PrismaClient();

interface TVLResult {
  totalValueLocked: number;
  byContract: Record<string, number>;
}

interface ActiveStreamsResult {
  count: number;
  contractBreakdown: Record<string, number>;
}

interface TotalStreamsResult {
  count: number;
  contractBreakdown: Record<string, number>;
}

interface ErrorRateResult {
  errorsLast1h: number;
  errorsLast24h: number;
  ratePer100Events: number;
}

interface TopUsersResult {
  address: string;
  totalVolume: number;
  transactionCount: number;
  lastActive: Date;
}

interface PauseStatus {
  isPaused: boolean;
  contracts: Record<string, boolean>;
}

async function getServer(): Promise<StellarSdk.SorobanRpc.Server> {
  return new StellarSdk.SorobanRpc.Server(config.stellar.networkUrl, {
    allowHttp: config.stellar.networkUrl.startsWith("http://"),
  });
}

async function tryGetContractState(
  server: StellarSdk.SorobanRpc.Server,
  contractId: string,
  storageKey: string
): Promise<unknown> {
  try {
    const contract = new StellarSdk.Contract(contractId);
    const key = StellarSdk.xdr.ScVal.fromBase64(storageKey);

    const response = await server.getContractData(contractId, key);
    if (response && "xdr" in response) {
      return response.xdr;
    }
    return null;
  } catch {
    return null;
  }
}

export async function computeTVL(): Promise<TVLResult> {
  const result: TVLResult = {
    totalValueLocked: 0,
    byContract: {},
  };

  const server = await getServer();

  for (const contractId of CONTRACT_IDS) {
    try {
      const contract = new StellarSdk.Contract(contractId);

      const tryKeys = [
        StellarSdk.xdr.ScVal.scvVec([
          StellarSdk.xdr.ScVal.scvSymbol("balances"),
        ]),
        StellarSdk.xdr.ScVal.scvMap([
          StellarSdk.xdr.ScVal.scvSymbol("claimable_balances"),
        ]),
      ];

      let contractTvL = 0;

      for (const key of tryKeys) {
        try {
          const response = await server.getContractData(contractId, key);
          if (response && "xdr" in response) {
            const xdrVal = response.xdr as string;
            const scVal = StellarSdk.xdr.ScVal.fromBase64(xdrVal);

            if (scVal.switch().name === "scvVec" || scVal.switch().name === "scvMap") {
              const nested = scVal.vec() || scVal.map();
              if (nested) {
                for (const entry of nested) {
                  const amountEntry = entry.address ? entry : entry;
                  const amountVal = (amountEntry as Record<string, unknown>).val
                    || (amountEntry as Record<string, unknown>).amount;
                  if (amountVal) {
                    contractTvL += extractNumericValue(amountVal);
                  }
                }
              }
            }
            break;
          }
        } catch {
          continue;
        }
      }

      if (contractTvL === 0) {
        const dbActivity = await prisma.recentActivity.aggregate({
          where: { contractAddress: contractId },
          _sum: { amount: true },
        });
        contractTvL = dbActivity._sum.amount ?? 0;
      }

      result.byContract[contractId] = contractTvL;
      result.totalValueLocked += contractTvL;
    } catch (error) {
      console.error(`[Metrics] Error computing TVL for ${contractId}:`, error);
      result.byContract[contractId] = 0;
    }
  }

  if (CONTRACT_IDS.length === 0) {
    const dbAggregate = await prisma.recentActivity.aggregate({
      _sum: { amount: true },
    });
    result.totalValueLocked = dbAggregate._sum.amount ?? 0;
  }

  return result;
}

function extractNumericValue(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val) / 1_000_000;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (obj.i128) {
      const inner = obj.i128 as Record<string, unknown>;
      const hi = Number(inner.hi ?? 0);
      const lo = Number(inner.lo ?? 0);
      return (hi * 0x100000000 + lo) / 1_000_000;
    }
  }
  return 0;
}

export async function computeActiveStreams(): Promise<ActiveStreamsResult> {
  const result: ActiveStreamsResult = {
    count: 0,
    contractBreakdown: {},
  };

  const server = await getServer();

  for (const contractId of CONTRACT_IDS) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const streamsFromDb = await prisma.recentActivity.count({
        where: {
          contractAddress: contractId,
          eventType: { in: ["paysent", "indivpay", "sched"] },
        },
      });

      const cancelledStreams = await prisma.recentActivity.count({
        where: {
          contractAddress: contractId,
          eventType: "cancel",
        },
      });

      const claimedStreams = await prisma.recentActivity.count({
        where: {
          contractAddress: contractId,
          eventType: "claimed",
        },
      });

      const active = Math.max(0, streamsFromDb - cancelledStreams - claimedStreams);
      result.contractBreakdown[contractId] = active;
      result.count += active;
    } catch (error) {
      console.error(`[Metrics] Error computing active streams for ${contractId}:`, error);
      result.contractBreakdown[contractId] = 0;
    }
  }

  return result;
}

export async function computeTotalStreamsCreated(): Promise<TotalStreamsResult> {
  const result: TotalStreamsResult = {
    count: 0,
    contractBreakdown: {},
  };

  for (const contractId of CONTRACT_IDS) {
    try {
      const count = await prisma.recentActivity.count({
        where: {
          contractAddress: contractId,
          eventType: { in: ["sched", "splitexec"] },
        },
      });
      result.contractBreakdown[contractId] = count;
      result.count += count;
    } catch (error) {
      console.error(`[Metrics] Error computing total streams for ${contractId}:`, error);
      result.contractBreakdown[contractId] = 0;
    }
  }

  return result;
}

export async function computeGasCostStats() {
  return prisma.gasCostStats.findMany({
    orderBy: { avgGasCost: "desc" },
  });
}

export async function computeErrorRates(): Promise<ErrorRateResult> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const errorsLast1h = await prisma.errorLog.count({
    where: {
      timestamp: { gte: oneHourAgo },
    },
  });

  const errorsLast24h = await prisma.errorLog.count({
    where: {
      timestamp: { gte: twentyFourHoursAgo },
    },
  });

  const eventsLast24h = await prisma.recentActivity.count({
    where: {
      timestamp: { gte: twentyFourHoursAgo },
    },
  });

  const ratePer100Events =
    eventsLast24h > 0 ? (errorsLast24h / eventsLast24h) * 100 : 0;

  return {
    errorsLast1h,
    errorsLast24h,
    ratePer100Events,
  };
}

export async function computeTopUsers(limit: number = 20): Promise<TopUsersResult[]> {
  return prisma.userVolume.findMany({
    orderBy: { totalVolume: "desc" },
    take: limit,
  });
}

export async function computeContractPauseStatus(): Promise<PauseStatus> {
  const result: PauseStatus = {
    isPaused: false,
    contracts: {},
  };

  const server = await getServer();

  for (const contractId of CONTRACT_IDS) {
    try {
      const pauseKey = StellarSdk.xdr.ScVal.scvVec([
        StellarSdk.xdr.ScVal.scvSymbol("pause"),
      ]);

      const response = await server.getContractData(contractId, pauseKey);

      if (response && "xdr" in response) {
        const xdrVal = response.xdr as string;
        const scVal = StellarSdk.xdr.ScVal.fromBase64(xdrVal);
        const isPaused =
          scVal.switch().name === "scvBool" ? scVal.b() : false;
        result.contracts[contractId] = isPaused;
        if (isPaused) result.isPaused = true;
      } else {
        result.contracts[contractId] = false;
      }
    } catch (error) {
      console.error(
        `[Metrics] Error checking pause status for ${contractId}:`,
        error
      );
      result.contracts[contractId] = false;
    }
  }

  return result;
}

export async function getOverview() {
  const [tvlResult, activeStreamsResult, totalStreamsResult, errorRates, pauseStatus] =
    await Promise.all([
      computeTVL(),
      computeActiveStreams(),
      computeTotalStreamsCreated(),
      computeErrorRates(),
      computeContractPauseStatus(),
    ]);

  const latestMetrics = await prisma.streamMetrics.findFirst({
    orderBy: { timestamp: "desc" },
  });

  return {
    totalValueLocked: tvlResult.totalValueLocked,
    tvlByContract: tvlResult.byContract,
    activeStreams: activeStreamsResult.count,
    activeStreamsByContract: activeStreamsResult.contractBreakdown,
    totalStreamsCreated: totalStreamsResult.count,
    totalStreamsByContract: totalStreamsResult.contractBreakdown,
    errorRates,
    isPaused: pauseStatus.isPaused,
    contractPauseStatus: pauseStatus.contracts,
    lastUpdated: latestMetrics?.timestamp?.toISOString() ?? new Date().toISOString(),
  };
}

export async function storeMetricsSnapshot(): Promise<void> {
  try {
    const overview = await getOverview();

    await prisma.streamMetrics.create({
      data: {
        totalValueLocked: overview.totalValueLocked,
        activeStreams: overview.activeStreams,
        totalStreamsCreated: overview.totalStreamsCreated,
        timestamp: new Date(),
      },
    });

    console.log(`[Metrics] Stored snapshot: TVL=${overview.totalValueLocked}, Streams=${overview.activeStreams}`);
  } catch (error) {
    console.error("[Metrics] Error storing snapshot:", error);
  }
}
