import { PrismaClient, RecentActivity, GasCostStats } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config, CONTRACT_IDS, EVENT_TYPES, EventType } from "./config";

const prisma = new PrismaClient();

interface EventRecord {
  eventType: EventType;
  sender: string;
  recipients: string[];
  amount: number;
  asset: string;
  contractAddress: string;
  ledger: number;
  txHash: string;
  timestamp: Date;
}

function classifyEvent(type: string): EventType {
  const lower = type.toLowerCase();
  if (lower.includes("splitexec") || lower.includes("split_exec")) return EVENT_TYPES.SPLIT_EXEC;
  if (lower.includes("paysent") || lower.includes("pay_sent")) return EVENT_TYPES.PAY_SENT;
  if (lower.includes("indivpay") || lower.includes("indiv_pay")) return EVENT_TYPES.INDIV_PAY;
  if (lower.includes("sched")) return EVENT_TYPES.SCHEDULED;
  if (lower.includes("cancel")) return EVENT_TYPES.CANCEL;
  if (lower.includes("claimed")) return EVENT_TYPES.CLAIMED;
  if (lower.includes("affiliate")) return EVENT_TYPES.AFFILIATE;
  if (lower.includes("admprop") || lower.includes("admin_prop")) return EVENT_TYPES.ADMIN_PROPOSAL;
  if (lower.includes("setstate") || lower.includes("set_state")) return EVENT_TYPES.SET_STATE;
  if (lower.includes("verified")) return EVENT_TYPES.VERIFIED;
  return EVENT_TYPES.PAY_SENT;
}

function extractAddress(val: unknown): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.address === "string") return obj.address;
    if (obj._switch && typeof obj._switch === "string") return obj._switch;
  }
  return String(val);
}

function extractAmount(val: unknown): number {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val) / 1_000_000;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (obj.i128 && typeof obj.i128 === "object") {
      const inner = obj.i128 as Record<string, unknown>;
      const hi = typeof inner.hi === "number" ? inner.hi : 0;
      const lo = typeof inner.lo === "number" ? inner.lo : Number(inner.lo ?? 0);
      return (hi * 0x100000000 + lo) / 1_000_000;
    }
    if (obj.body && typeof obj.body === "object") {
      return extractAmount(obj.body);
    }
  }
  return 0;
}

function extractRecipients(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(extractAddress).filter((a) => a.length > 0);
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.addresses)) return obj.addresses.map(extractAddress).filter((a) => a.length > 0);
    if (Array.isArray(obj.recipients)) return obj.recipients.map(extractAddress).filter((a) => a.length > 0);
  }
  return [];
}

function parseScVals(vals: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = ["sender", "recipients", "amount", "asset", "contract", "data", "details"];

  for (let i = 0; i < vals.length && i < keys.length; i++) {
    result[keys[i]] = vals[i];
  }

  if (vals.length > keys.length) {
    result["extra"] = vals.slice(keys.length);
  }

  return result;
}

async function getLastIndexedLedger(): Promise<number> {
  const record = await prisma.recentActivity.findFirst({
    orderBy: { ledger: "desc" },
    select: { ledger: true },
  });
  return record ? record.ledger : 0;
}

function createServer(): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(config.stellar.networkUrl, {
    allowHttp: config.stellar.networkUrl.startsWith("http://"),
  });
}

async function fetchContractEvents(
  server: StellarSdk.SorobanRpc.Server,
  startLedger: number
): Promise<StellarSdk.SorobanRpc.Api.LedgerEntryResult[]> {
  const events: StellarSdk.SorobanRpc.Api.LedgerEntryResult[] = [];

  try {
    const response = await server.getEvents({
      startLedger: startLedger.toString(),
      filters: CONTRACT_IDS.map((contractId) => ({
        type: "contract" as StellarSdk.SorobanRpc.Api.EventFilterType,
        contractIds: [contractId],
      })),
      limit: 200,
    });

    for (const event of response.events) {
      events.push(event as unknown as StellarSdk.SorobanRpc.Api.LedgerEntryResult);
    }

    return events;
  } catch (error) {
    console.error("[Indexer] Error fetching events:", error);
    return [];
  }
}

function processRawEvent(rawEvent: Record<string, unknown>): EventRecord | null {
  try {
    const topic = rawEvent.topic as unknown[] | undefined;
    const contractId = extractAddress(rawEvent.contractId);
    const ledgerSeq = (rawEvent.ledger as number) || 0;
    const txHash = extractAddress(rawEvent.transactionHash) || "";
    const eventTypeStr = topic && topic.length > 0 ? extractAddress(topic[0]) : "unknown";
    const eventType = classifyEvent(eventTypeStr);

    const vals = parseScVals(rawEvent.value && typeof rawEvent.value === "object"
      ? ((rawEvent.value as Record<string, unknown>).values as unknown[]) || []
      : []);

    return {
      eventType,
      sender: extractAddress(vals.sender),
      recipients: extractRecipients(vals.recipients),
      amount: extractAmount(vals.amount),
      asset: extractAddress(vals.asset) || "XLM",
      contractAddress: contractId,
      ledger: ledgerSeq,
      txHash,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("[Indexer] Error processing raw event:", error);
    return null;
  }
}

async function storeEvents(records: EventRecord[]): Promise<void> {
  for (const record of records) {
    try {
      await prisma.recentActivity.create({
        data: {
          eventType: record.eventType,
          sender: record.sender,
          recipients: JSON.stringify(record.recipients),
          amount: record.amount,
          asset: record.asset,
          contractAddress: record.contractAddress,
          ledger: record.ledger,
          txHash: record.txHash,
          timestamp: record.timestamp,
        },
      });

      if (record.sender && record.amount > 0) {
        await upsertUserVolume(record.sender, record.amount);
      }

      for (const recipient of record.recipients) {
        if (recipient && record.amount > 0) {
          await upsertUserVolume(recipient, record.amount);
        }
      }

      if (record.eventType === EVENT_TYPES.ADMIN_PROPOSAL) {
        await storeAdminOperation(record);
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") {
        console.error("[Indexer] Error storing event:", error);
      }
    }
  }
}

async function upsertUserVolume(address: string, volume: number): Promise<void> {
  try {
    await prisma.userVolume.upsert({
      where: { address },
      create: {
        address,
        totalVolume: volume,
        transactionCount: 1,
        lastActive: new Date(),
      },
      update: {
        totalVolume: { increment: volume },
        transactionCount: { increment: 1 },
        lastActive: new Date(),
      },
    });
  } catch (error) {
    console.error("[Indexer] Error upserting user volume:", error);
  }
}

async function storeAdminOperation(record: EventRecord): Promise<void> {
  try {
    await prisma.adminOperation.create({
      data: {
        operation: record.eventType,
        admin: record.sender,
        details: JSON.stringify({
          recipients: record.recipients,
          amount: record.amount,
          asset: record.asset,
        }),
        ledger: record.ledger,
        timestamp: record.timestamp,
      },
    });
  } catch (error) {
    console.error("[Indexer] Error storing admin operation:", error);
  }
}

async function updateGasStats(
  events: Record<string, unknown>[],
  ledger: number
): Promise<void> {
  for (const event of events) {
    const txHash = extractAddress(event.transactionHash);
    const eventType = classifyEvent(
      extractAddress((event.topic as unknown[])?.[0] ?? "unknown")
    );

    try {
      const server = createServer();
      if (txHash) {
        const txResponse = await server.getTransaction(txHash);

        if (txResponse && "resultXdr" in txResponse) {
          const resultXdr = txResponse.resultXdr as string;
          const meta = txResponse.sorobanMeta as Record<string, unknown> | undefined;
          let actualFee = 100;

          if (meta) {
            const ledgerClosed = meta.ledgerClosingCosts as Record<string, unknown> | undefined;
            if (ledgerClosed) {
              const resourceFee = Number(ledgerClosed.resourceFee ?? 0);
              const txFee = Number(ledgerClosed.txFee ?? 0);
              actualFee = resourceFee + txFee;
            }
          }

          await upsertGasCost(eventType, actualFee);
        }
      }
    } catch {
      await upsertGasCost(eventType, 100);
    }
  }
}

async function upsertGasCost(operation: string, cost: number): Promise<void> {
  try {
    const existing = await prisma.gasCostStats.findUnique({ where: { operation } });

    if (existing) {
      const newSampleCount = existing.sampleCount + 1;
      const newAvg =
        (existing.avgGasCost * existing.sampleCount + cost) / newSampleCount;
      const newMin = Math.min(existing.minGasCost, cost);
      const newMax = Math.max(existing.maxGasCost, cost);

      await prisma.gasCostStats.update({
        where: { operation },
        data: {
          avgGasCost: newAvg,
          minGasCost: newMin,
          maxGasCost: newMax,
          sampleCount: newSampleCount,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.gasCostStats.create({
        data: {
          operation,
          avgGasCost: cost,
          minGasCost: cost,
          maxGasCost: cost,
          sampleCount: 1,
        },
      });
    }
  } catch (error) {
    console.error("[Indexer] Error upserting gas cost:", error);
  }
}

async function checkForErrors(
  events: Record<string, unknown>[],
  ledger: number
): Promise<void> {
  for (const event of events) {
    const status = extractAddress(event.status);
    const topic = event.topic as unknown[] | undefined;
    const eventType = classifyEvent(extractAddress(topic?.[0] ?? "unknown"));

    if (status.includes("error") || status.includes("fail")) {
      const errorMsg = extractAddress(event.error) || `Event failed: ${eventType}`;
      const errorCode = extractAddress(event.errorCode) || eventType.toUpperCase();

      try {
        await prisma.errorLog.create({
          data: {
            errorCode,
            message: errorMsg,
            contractAddress: extractAddress(event.contractId),
            ledger,
            timestamp: new Date(),
            resolved: false,
          },
        });
      } catch (error) {
        console.error("[Indexer] Error logging error event:", error);
      }
    }
  }
}

export async function indexNewEvents(): Promise<void> {
  try {
    const lastLedger = await getLastIndexedLedger();
    const startLedger = lastLedger > 0 ? lastLedger + 1 : 0;

    if (CONTRACT_IDS.length === 0) {
      return;
    }

    const server = createServer();
    const rawEvents = await fetchContractEvents(server, startLedger);

    if (rawEvents.length === 0) {
      return;
    }

    console.log(`[Indexer] Processing ${rawEvents.length} events from ledger ${startLedger}`);

    const eventRecords: EventRecord[] = [];
    const rawEventObjects: Record<string, unknown>[] = [];

    for (const rawEvent of rawEvents) {
      const rawObj = rawEvent as unknown as Record<string, unknown>;
      rawEventObjects.push(rawObj);
      const record = processRawEvent(rawObj);
      if (record) {
        eventRecords.push(record);
      }
    }

    if (eventRecords.length > 0) {
      await storeEvents(eventRecords);
    }

    const highestLedger = eventRecords.reduce(
      (max, r) => Math.max(max, r.ledger),
      startLedger
    );

    if (highestLedger > lastLedger) {
      await updateGasStats(rawEventObjects, highestLedger);
      await checkForErrors(rawEventObjects, highestLedger);
    }

    console.log(`[Indexer] Indexed ${eventRecords.length} events up to ledger ${highestLedger}`);
  } catch (error) {
    console.error("[Indexer] Error during indexing cycle:", error);
  }
}

export async function startIndexer(): Promise<void> {
  console.log("[Indexer] Starting event indexer");
  console.log(`[Indexer] Polling interval: ${config.refresh.indexerIntervalSeconds}s`);
  console.log(`[Indexer] Tracking contracts: ${CONTRACT_IDS.length}`);

  await indexNewEvents();
}
