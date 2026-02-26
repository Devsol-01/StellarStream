import { prisma } from "../lib/db";
import { StreamStatus } from "../generated/client";

export type StreamDirection = "inbound" | "outbound";
export type StreamStatusFilter = "active" | "paused" | "completed";

interface StreamFilters {
  direction?: StreamDirection;
  status?: StreamStatusFilter;
  tokenAddresses?: string[];
}

export class StreamService {
  async getStreamsForAddress(address: string, filters: StreamFilters = {}) {
    const { direction, status, tokenAddresses } = filters;

    const where: any = {
      ...(direction === "inbound" && { receiver: address }),
      ...(direction === "outbound" && { sender: address }),
      ...(!direction && {
        OR: [{ sender: address }, { receiver: address }],
      }),
      ...(status && { status: status.toUpperCase() as StreamStatus }),
      ...(tokenAddresses?.length && { tokenAddress: { in: tokenAddresses } }),
    };

    return prisma.stream.findMany({
      where,
      orderBy: { id: "desc" },
    });
  }
}
