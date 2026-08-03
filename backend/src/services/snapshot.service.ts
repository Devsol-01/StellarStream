/**
 * Snapshot Service
 * Creates hourly snapshots of contract states for historical analysis
 */

import { PrismaClient } from "../generated/client/index.js";
import { logger } from "../logger.js";
import zlib from "zlib";

const prisma = new PrismaClient();

interface StreamState {
  streamId: string;
  contractId?: string;
  sender: string;
  receiver: string;
  tokenAddress: string;
  totalAmount: bigint;
  withdrawnAmount: bigint;
  cliffTime: bigint;
  startTime: Date;
  endTime: Date;
  state: string;
  curveType: number;
  isSoulbound: boolean;
  isFrozen: boolean;
  pausedDuration: bigint;
  vaultAddress?: string;
  vaultShares?: bigint;
}

export class SnapshotService {
  /**
   * Create hourly snapshots for all active streams
   */
  async createHourlySnapshots(): Promise<{ count: number; timestamp: string }> {
    const snapshotHour = this.getCurrentHour();
    const timestamp = new Date().toISOString();

    try {
      const streams = await prisma.stream.findMany({
        where: {
          status: { in: ["ACTIVE", "PAUSED"] },
        },
      });

      let created = 0;
      for (const stream of streams) {
        const previousSnapshot = await this.getPreviousHourlySnapshot(stream.id);

        const currentState: StreamState = {
          streamId: stream.id,
          contractId: stream.contractId ?? undefined,
          sender: stream.sender,
          receiver: stream.receiver,
          tokenAddress: stream.tokenAddress ?? "",
          totalAmount: BigInt(stream.amount ?? "0"),
          withdrawnAmount: BigInt(stream.withdrawn ?? "0"),
          cliffTime: stream.cliffTime ? BigInt(stream.cliffTime) : 0n,
          startTime: stream.startTime ?? new Date(),
          endTime: stream.endTime ?? new Date(),
          state: stream.status,
          curveType: 0,
          isSoulbound: stream.isSoulbound ?? false,
          isFrozen: stream.isFrozen ?? false,
          pausedDuration: stream.pausedDuration ? BigInt(stream.pausedDuration) : 0n,
          vaultAddress: stream.vaultAddress ?? undefined,
          vaultShares: stream.vaultShares ? BigInt(stream.vaultShares) : undefined,
        };

        const compressedState = previousSnapshot
          ? this.compressDelta(currentState, previousSnapshot)
          : undefined;

        await prisma.contractStateSnapshot.upsert({
          where: {
            streamId_snapshotHour: {
              streamId: stream.id,
              snapshotHour,
            },
          },
          update: {
            sender: currentState.sender,
            receiver: currentState.receiver,
            tokenAddress: currentState.tokenAddress,
            totalAmount: currentState.totalAmount,
            withdrawnAmount: currentState.withdrawnAmount,
            state: currentState.state as any,
            compressedState,
            previousSnapshotId: previousSnapshot?.id,
          },
          create: {
            streamId: stream.id,
            contractId: currentState.contractId,
            snapshotTime: new Date(),
            snapshotHour,
            sender: currentState.sender,
            receiver: currentState.receiver,
            tokenAddress: currentState.tokenAddress,
            totalAmount: currentState.totalAmount,
            withdrawnAmount: currentState.withdrawnAmount,
            cliffTime: currentState.cliffTime,
            startTime: currentState.startTime,
            endTime: currentState.endTime,
            state: currentState.state as any,
            curveType: currentState.curveType,
            isSoulbound: currentState.isSoulbound,
            isFrozen: currentState.isFrozen,
            pausedDuration: currentState.pausedDuration,
            vaultAddress: currentState.vaultAddress,
            vaultShares: currentState.vaultShares,
            compressedState,
            previousSnapshotId: previousSnapshot?.id,
          },
        });
        created++;
      }

      logger.info(`Created hourly snapshots for ${created} streams`, {
        snapshotHour,
      });
      return { count: created, timestamp };
    } catch (error) {
      logger.error("Failed to create hourly snapshots", error);
      throw error;
    }
  }

  /**
   * Get snapshot closest to a specific point in time
   */
  async getSnapshotAtTime(
    streamId: string,
    timestamp: Date,
  ): Promise<StreamState | null> {
    const snapshot = await prisma.contractStateSnapshot.findFirst({
      where: {
        streamId,
        snapshotTime: { lte: timestamp },
      },
      orderBy: { snapshotTime: "desc" },
    });

    if (!snapshot) return null;

    const currentState: StreamState = {
      streamId: snapshot.streamId,
      contractId: snapshot.contractId ?? undefined,
      sender: snapshot.sender,
      receiver: snapshot.receiver,
      tokenAddress: snapshot.tokenAddress,
      totalAmount: snapshot.totalAmount,
      withdrawnAmount: snapshot.withdrawnAmount,
      cliffTime: snapshot.cliffTime,
      startTime: snapshot.startTime,
      endTime: snapshot.endTime,
      state: snapshot.state,
      curveType: snapshot.curveType,
      isSoulbound: snapshot.isSoulbound,
      isFrozen: snapshot.isFrozen,
      pausedDuration: snapshot.pausedDuration,
      vaultAddress: snapshot.vaultAddress ?? undefined,
      vaultShares: snapshot.vaultShares ?? undefined,
    };

    return currentState;
  }

  /**
   * Compare two snapshots and return differences
   */
  async compareSnapshots(
    streamId: string,
    timeA: Date,
    timeB: Date,
  ): Promise<{
    snapshotA: StreamState | null;
    snapshotB: StreamState | null;
    differences: Record<string, { before: any; after: any }>;
  }> {
    const [snapshotA, snapshotB] = await Promise.all([
      this.getSnapshotAtTime(streamId, timeA),
      this.getSnapshotAtTime(streamId, timeB),
    ]);

    const differences: Record<string, { before: any; after: any }> = {};

    if (snapshotA && snapshotB) {
      const keys: (keyof StreamState)[] = [
        "state",
        "totalAmount",
        "withdrawnAmount",
      ];
      for (const key of keys) {
        const before = (snapshotA as any)[key];
        const after = (snapshotB as any)[key];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          differences[key] = { before, after };
        }
      }
    }

    return { snapshotA, snapshotB, differences };
  }

  /**
   * Restore stream state from a specific snapshot
   */
  async restoreFromSnapshot(
    streamId: string,
    targetTime: Date,
  ): Promise<boolean> {
    const snapshot = await this.getSnapshotAtTime(streamId, targetTime);
    if (!snapshot) return false;

    await prisma.stream.update({
      where: { id: streamId },
      data: {
        status: snapshot.state as any,
        withdrawn: snapshot.withdrawnAmount.toString(),
        isFrozen: snapshot.isFrozen,
      },
    });

    logger.info(`Restored stream ${streamId} to state at ${targetTime.toISOString()}`);
    return true;
  }

  /**
   * Get all hourly snapshots for a stream within a time range
   */
  async getHourlySnapshots(
    streamId: string,
    from?: Date,
    to?: Date,
  ): Promise<StreamState[]> {
    const snapshots = await prisma.contractStateSnapshot.findMany({
      where: {
        streamId,
        snapshotTime: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { snapshotTime: "desc" },
    });

    return snapshots.map((s) => ({
      streamId: s.streamId,
      contractId: s.contractId ?? undefined,
      sender: s.sender,
      receiver: s.receiver,
      tokenAddress: s.tokenAddress,
      totalAmount: s.totalAmount,
      withdrawnAmount: s.withdrawnAmount,
      cliffTime: s.cliffTime,
      startTime: s.startTime,
      endTime: s.endTime,
      state: s.state,
      curveType: s.curveType,
      isSoulbound: s.isSoulbound,
      isFrozen: s.isFrozen,
      pausedDuration: s.pausedDuration,
      vaultAddress: s.vaultAddress ?? undefined,
      vaultShares: s.vaultShares ?? undefined,
    }));
  }

  /**
   * Create monthly snapshots for all active streams
   */
  async createMonthlySnapshots(): Promise<void> {
    const snapshotMonth = this.getCurrentMonth();

    try {
      const streams = await prisma.stream.findMany();

      for (const stream of streams) {
        const totalAmount = BigInt(stream.amount ?? "0");
        const durationSec = BigInt(stream.duration ?? 1);
        const amountPerSecond =
          durationSec > 0n ? totalAmount / durationSec : 0n;
        const tokenAddress = stream.tokenAddress ?? "";

        await prisma.streamSnapshot.upsert({
          where: {
            streamId_snapshotMonth: {
              streamId: stream.id,
              snapshotMonth,
            },
          },
          update: {
            sender: stream.sender,
            receiver: stream.receiver,
            tokenAddress,
            amountPerSecond,
            totalAmount,
            status: stream.status,
          },
          create: {
            streamId: stream.id,
            sender: stream.sender,
            receiver: stream.receiver,
            tokenAddress,
            amountPerSecond,
            totalAmount,
            status: stream.status,
            snapshotMonth,
          },
        });
      }

      logger.info(`Created snapshots for ${streams.length} streams`, {
        snapshotMonth,
      });
    } catch (error) {
      logger.error("Failed to create monthly snapshots", error);
      throw error;
    }
  }

  /**
   * Archive event logs older than 3 months
   */
  async archiveOldLogs(): Promise<number> {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    try {
      const oldLogs = await prisma.eventLog.findMany({
        where: {
          createdAt: {
            lt: threeMonthsAgo,
          },
        },
      });

      if (oldLogs.length === 0) {
        logger.info("No logs to archive");
        return 0;
      }

      await prisma.streamArchive.createMany({
        data: oldLogs.map((log) => ({
          id: log.id,
          eventType: log.eventType,
          streamId: log.streamId,
          txHash: log.txHash,
          ledger: log.ledger,
          ledgerClosedAt: log.ledgerClosedAt,
          sender: log.sender,
          receiver: log.receiver,
          amount: log.amount,
          metadata: log.metadata,
          createdAt: log.createdAt,
        })),
      });

      await prisma.eventLog.deleteMany({
        where: {
          createdAt: {
            lt: threeMonthsAgo,
          },
        },
      });

      logger.info(`Archived ${oldLogs.length} event logs`, {
        cutoffDate: threeMonthsAgo.toISOString(),
      });

      return oldLogs.length;
    } catch (error) {
      logger.error("Failed to archive old logs", error);
      throw error;
    }
  }

  /**
   * Run both snapshot and archive operations
   */
  async runMaintenance(): Promise<{ snapshotsCreated: boolean; logsArchived: number }> {
    await this.createMonthlySnapshots();
    const logsArchived = await this.archiveOldLogs();

    return {
      snapshotsCreated: true,
      logsArchived,
    };
  }

  /**
   * Get current month in YYYY-MM format
   */
  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  /**
   * Get current hour in YYYY-MM-DD-HH format
   */
  private getCurrentHour(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    return `${year}-${month}-${day}-${hour}`;
  }

  /**
   * Compress delta between current and previous state
   */
  private compressDelta(
    current: StreamState,
    previous: StreamState,
  ): string | undefined {
    const delta: Record<string, any> = {};

    if (current.totalAmount !== previous.totalAmount) {
      delta.totalAmount = current.totalAmount;
    }
    if (current.withdrawnAmount !== previous.withdrawnAmount) {
      delta.withdrawnAmount = current.withdrawnAmount;
    }
    if (current.state !== previous.state) {
      delta.state = current.state;
    }

    if (Object.keys(delta).length === 0) return undefined;

    const json = JSON.stringify(delta);
    return zlib
      .gzipSync(json)
      .toString("base64");
  }

  /**
   * Get previous snapshot for delta compression
   */
  private async getPreviousHourlySnapshot(
    streamId: string,
  ): Promise<StreamState | null> {
    const snapshot = await prisma.contractStateSnapshot.findFirst({
      where: { streamId },
      orderBy: { snapshotTime: "desc" },
    });

    if (!snapshot) return null;

    return {
      streamId: snapshot.streamId,
      contractId: snapshot.contractId ?? undefined,
      sender: snapshot.sender,
      receiver: snapshot.receiver,
      tokenAddress: snapshot.tokenAddress,
      totalAmount: snapshot.totalAmount,
      withdrawnAmount: snapshot.withdrawnAmount,
      cliffTime: snapshot.cliffTime,
      startTime: snapshot.startTime,
      endTime: snapshot.endTime,
      state: snapshot.state,
      curveType: snapshot.curveType,
      isSoulbound: snapshot.isSoulbound,
      isFrozen: snapshot.isFrozen,
      pausedDuration: snapshot.pausedDuration,
      vaultAddress: snapshot.vaultAddress ?? undefined,
      vaultShares: snapshot.vaultShares ?? undefined,
    };
  }

  /**
   * Get snapshot for a specific stream and month
   */
  async getSnapshot(streamId: string, month?: string) {
    const snapshotMonth = month || this.getCurrentMonth();

    return prisma.streamSnapshot.findUnique({
      where: {
        streamId_snapshotMonth: {
          streamId,
          snapshotMonth,
        },
      },
    });
  }

  /**
   * Get all snapshots for a stream
   */
  async getStreamSnapshots(streamId: string) {
    return prisma.streamSnapshot.findMany({
      where: { streamId },
      orderBy: { snapshotMonth: "desc" },
    });
  }

  /**
   * Get archived logs for a stream
   */
  async getArchivedLogs(streamId: string) {
    return prisma.streamArchive.findMany({
      where: { streamId },
      orderBy: { createdAt: "desc" },
    });
  }
}