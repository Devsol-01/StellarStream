/**
 * StellarStream Node.js Backend Example
 * 
 * This example demonstrates a Node.js backend integration with:
 * 1. Express API server
 * 2. Stream queries
 * 3. Webhook handling
 * 4. Database integration
 */

import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Contract, rpc as SorobanRpc, Address, u64, i128 } from "@stellar/stellar-sdk";

// ============================================================================
// Configuration
// ============================================================================

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Stellar configuration
const RPC_URL = process.env.RPC_URL || "https://soroban-rpc.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 
  "Public Global Stellar Network ; September 2015";
const CONTRACT_ID = process.env.STELLARSTREAM_CONTRACT_ID || "";

// Initialize RPC server and contract
const rpcServer = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

// ============================================================================
// Middleware
// ============================================================================

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// Types
// ============================================================================

interface Stream {
  streamId: bigint;
  sender: string;
  receiver: string;
  token: string;
  totalAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  withdrawn: bigint;
  cancelled: boolean;
  isPaused: boolean;
  curveType: "Linear" | "Exponential";
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// StellarStream Service
// ============================================================================

class StellarStreamService {
  async getStream(streamId: bigint): Promise<Stream> {
    const result = await rpcServer.invokeContractFunction(
      contract,
      "get_stream",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return this.parseStream(result);
  }

  async getUserStreams(userAddress: string): Promise<bigint[]> {
    const result = await rpcServer.invokeContractFunction(
      contract,
      "get_user_streams",
      [new Address(userAddress)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return result.map((id: any) => BigInt(id.toString()));
  }

  async getWithdrawableAmount(streamId: bigint): Promise<bigint> {
    const result = await rpcServer.invokeContractFunction(
      contract,
      "get_withdrawable_amount",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return BigInt(result.toString());
  }

  async getVersion(): Promise<string> {
    const result = await rpcServer.invokeContractFunction(
      contract,
      "get_version",
      [],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return result.toString();
  }

  private parseStream(data: any): Stream {
    return {
      streamId: BigInt(data.stream_id),
      sender: data.sender.toString(),
      receiver: data.receiver.toString(),
      token: data.token.toString(),
      totalAmount: BigInt(data.total_amount),
      startTime: BigInt(data.start_time),
      endTime: BigInt(data.end_time),
      withdrawn: BigInt(data.withdrawn_amount),
      cancelled: data.is_cancelled,
      isPaused: data.state === 1,
      curveType: data.curve_type === 0 ? "Linear" : "Exponential"
    };
  }
}

const stellarStreamService = new StellarStreamService();

// ============================================================================
// Routes
// ============================================================================

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get contract version
app.get("/api/version", async (req: Request, res: Response) => {
  try {
    const version = await stellarStreamService.getVersion();
    res.json({ version });
  } catch (error: any) {
    console.error("Error fetching version:", error);
    res.status(500).json({ error: "Failed to fetch version" });
  }
});

// Get stream by ID
app.get("/api/streams/:id", async (req: Request, res: Response) => {
  try {
    const streamId = BigInt(req.params.id);
    const stream = await stellarStreamService.getStream(streamId);

    res.json({
      success: true,
      data: {
        ...stream,
        streamId: stream.streamId.toString(),
        totalAmount: stream.totalAmount.toString(),
        startTime: stream.startTime.toString(),
        endTime: stream.endTime.toString(),
        withdrawn: stream.withdrawn.toString()
      }
    });
  } catch (error: any) {
    console.error("Error fetching stream:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stream"
    });
  }
});

// Get user's streams
app.get("/api/streams/user/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Validate address
    if (!address.startsWith("G") || address.length !== 56) {
      return res.status(400).json({
        success: false,
        error: "Invalid Stellar address"
      });
    }

    const streamIds = await stellarStreamService.getUserStreams(address);

    // Fetch stream details for each ID
    const streams = await Promise.all(
      streamIds.map(async (id) => {
        try {
          const stream = await stellarStreamService.getStream(id);
          return {
            ...stream,
            streamId: stream.streamId.toString(),
            totalAmount: stream.totalAmount.toString(),
            startTime: stream.startTime.toString(),
            endTime: stream.endTime.toString(),
            withdrawn: stream.withdrawn.toString()
          };
        } catch (error) {
          console.error(`Error fetching stream ${id}:`, error);
          return null;
        }
      })
    );

    // Filter out failed fetches
    const validStreams = streams.filter(stream => stream !== null);

    res.json({
      success: true,
      data: validStreams
    });
  } catch (error: any) {
    console.error("Error fetching user streams:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user streams"
    });
  }
});

// Get withdrawable amount
app.get("/api/streams/:id/withdrawable", async (req: Request, res: Response) => {
  try {
    const streamId = BigInt(req.params.id);
    const amount = await stellarStreamService.getWithdrawableAmount(streamId);

    res.json({
      success: true,
      data: {
        streamId: streamId.toString(),
        amount: amount.toString()
      }
    });
  } catch (error: any) {
    console.error("Error fetching withdrawable amount:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch withdrawable amount"
    });
  }
});

// Batch fetch streams
app.post("/api/streams/batch", async (req: Request, res: Response) => {
  try {
    const { streamIds } = req.body;

    if (!Array.isArray(streamIds)) {
      return res.status(400).json({
        success: false,
        error: "streamIds must be an array"
      });
    }

    const streams = await Promise.all(
      streamIds.map(async (id: string) => {
        try {
          const stream = await stellarStreamService.getStream(BigInt(id));
          return {
            ...stream,
            streamId: stream.streamId.toString(),
            totalAmount: stream.totalAmount.toString(),
            startTime: stream.startTime.toString(),
            endTime: stream.endTime.toString(),
            withdrawn: stream.withdrawn.toString()
          };
        } catch (error) {
          return { id, error: "Stream not found" };
        }
      })
    );

    res.json({
      success: true,
      data: streams
    });
  } catch (error: any) {
    console.error("Error batch fetching streams:", error);
    res.status(500).json({
      success: false,
      error: "Failed to batch fetch streams"
    });
  }
});

// ============================================================================
// Webhook Handler (for event notifications)
// ============================================================================

app.post("/api/webhooks/stream", async (req: Request, res: Response) => {
  try {
    const { event, streamId, data } = req.body;

    console.log("Webhook received:", { event, streamId, data });

    // Process webhook based on event type
    switch (event) {
      case "stream_created":
        console.log(`New stream created: ${streamId}`);
        // Add your business logic here
        break;

      case "withdrawal":
        console.log(`Withdrawal from stream ${streamId}: ${data.amount}`);
        // Add your business logic here
        break;

      case "stream_cancelled":
        console.log(`Stream cancelled: ${streamId}`);
        // Add your business logic here
        break;

      default:
        console.log(`Unknown event: ${event}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Not found"
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`StellarStream API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`RPC URL: ${RPC_URL}`);
});

export default app;
