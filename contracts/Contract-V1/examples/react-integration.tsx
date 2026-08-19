/**
 * StellarStream React Integration Example
 * 
 * This example demonstrates a complete React integration with:
 * 1. Wallet connection
 * 2. Stream dashboard
 * 3. Stream creation form
 * 4. Real-time updates
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { isConnected, requestAccess, getAddress, getNetwork, signTransaction } from "@stellar/freighter-api";
import { rpc as SorobanRpc, Contract, Address, u64, i128 } from "@stellar/stellar-sdk";

// ============================================================================
// Types
// ============================================================================

export interface Stream {
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

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  network: string | null;
  isConnecting: boolean;
  error: string | null;
}

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-rpc.stellar.org";
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || 
  "Public Global Stellar Network ; September 2015";
const CONTRACT_ID = process.env.NEXT_PUBLIC_STELLARSTREAM_CONTRACT_ID || "";

// ============================================================================
// Context
// ============================================================================

interface WalletContextType extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// ============================================================================
// Wallet Provider
// ============================================================================

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    network: null,
    isConnecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }));
    try {
      const connected = await isConnected();
      if (!connected) {
        throw new Error("Wallet not connected");
      }

      const address = await requestAccess();
      const networkInfo = await getNetwork();

      setState({
        isConnected: true,
        address,
        network: networkInfo.network,
        isConnecting: false,
        error: null,
      });
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error.message || "Failed to connect wallet",
      }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    setState({
      isConnected: false,
      address: null,
      network: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

// ============================================================================
// StellarStream Client
// ============================================================================

class StellarStreamClient {
  private contract: Contract;
  private server: SorobanRpc.Server;

  constructor(contractId: string = CONTRACT_ID) {
    this.contract = new Contract(contractId);
    this.server = new SorobanRpc.Server(RPC_URL);
  }

  async createStream(
    sender: string,
    receiver: string,
    token: string,
    totalAmount: bigint,
    startTime: bigint,
    endTime: bigint,
    curveType: "Linear" | "Exponential" = "Linear",
    isSoulbound: boolean = false
  ): Promise<bigint> {
    const curveTypeValue = curveType === "Linear" ? 0 : 1;

    const result = await this.server.invokeContractFunction(
      this.contract,
      "create_stream",
      [
        new Address(sender),
        new Address(receiver),
        new Address(token),
        i128(totalAmount),
        u64(startTime),
        u64(endTime),
        curveTypeValue,
        isSoulbound
      ],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return BigInt(result.toString());
  }

  async getStream(streamId: bigint): Promise<Stream> {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_stream",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return this.parseStream(result);
  }

  async getWithdrawableAmount(streamId: bigint): Promise<bigint> {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_withdrawable_amount",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return BigInt(result.toString());
  }

  async withdraw(streamId: bigint): Promise<bigint> {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "withdraw",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    return BigInt(result.toString());
  }

  async cancelStream(streamId: bigint): Promise<void> {
    await this.server.invokeContractFunction(
      this.contract,
      "cancel_stream",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );
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

export const stellarStreamClient = new StellarStreamClient();

// ============================================================================
// Components
// ============================================================================

export function WalletConnect() {
  const { isConnected, address, isConnecting, error, connect, disconnect } = useWallet();

  if (isConnected) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {address?.slice(0, 8)}...{address?.slice(-8)}
        </span>
        <button
          onClick={disconnect}
          className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={connect}
        disabled={isConnecting}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}

export function StreamDashboard() {
  const { address, isConnected } = useWallet();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected && address) {
      loadStreams();
    }
  }, [isConnected, address]);

  const loadStreams = async () => {
    setLoading(true);
    setError(null);
    try {
      // In a real app, you'd fetch stream IDs from the contract
      // For this example, we'll use a mock
      const mockStreams: Stream[] = [];
      setStreams(mockStreams);
    } catch (err) {
      setError("Failed to load streams");
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-4 bg-gray-100 rounded">
        <p>Please connect your wallet to view streams</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-4">Loading streams...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Your Streams</h2>
      {streams.length === 0 ? (
        <p className="text-gray-600">No streams found</p>
      ) : (
        streams.map(stream => (
          <StreamCard key={stream.streamId.toString()} stream={stream} />
        ))
      )}
    </div>
  );
}

function StreamCard({ stream }: { stream: Stream }) {
  const [withdrawable, setWithdrawable] = useState<bigint>(BigInt(0));

  useEffect(() => {
    const fetchWithdrawable = async () => {
      try {
        const amount = await stellarStreamClient.getWithdrawableAmount(stream.streamId);
        setWithdrawable(amount);
      } catch (err) {
        console.error("Failed to fetch withdrawable amount:", err);
      }
    };
    fetchWithdrawable();
  }, [stream.streamId]);

  const progress = Number((stream.withdrawn * BigInt(100)) / stream.totalAmount);

  return (
    <div className="p-4 border rounded-lg">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold">Stream #{stream.streamId.toString()}</h3>
          <p className="text-sm text-gray-600">
            To: {stream.receiver.slice(0, 8)}...
          </p>
        </div>
        <span className={`px-2 py-1 text-xs rounded ${
          !stream.cancelled && !stream.isPaused
            ? "bg-green-100 text-green-800"
            : "bg-gray-100 text-gray-800"
        }`}>
          {stream.isPaused ? "Paused" : stream.cancelled ? "Cancelled" : "Active"}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-between items-center">
        <div className="text-sm">
          <span className="text-gray-600">Withdrawable: </span>
          <span className="font-semibold">{withdrawable.toString()}</span>
        </div>
        <button
          disabled={withdrawable === BigInt(0)}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}

export function CreateStream() {
  const { address, isConnected } = useWallet();
  const [form, setForm] = useState({
    receiver: "",
    token: "",
    totalAmount: "",
    duration: "30",
    curveType: "Linear" as "Linear" | "Exponential",
    isSoulbound: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const now = Math.floor(Date.now() / 1000);
      const durationInSeconds = parseInt(form.duration) * 24 * 60 * 60;

      await stellarStreamClient.createStream(
        address,
        form.receiver,
        form.token,
        BigInt(form.totalAmount),
        BigInt(now),
        BigInt(now + durationInSeconds),
        form.curveType,
        form.isSoulbound
      );

      setSuccess(true);
      setForm({
        receiver: "",
        token: "",
        totalAmount: "",
        duration: "30",
        curveType: "Linear",
        isSoulbound: false,
      });
    } catch (err: any) {
      setError(err.message || "Failed to create stream");
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-4 bg-gray-100 rounded">
        <p>Please connect your wallet to create a stream</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <h2 className="text-2xl font-bold">Create Stream</h2>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>
      )}

      {success && (
        <div className="p-3 bg-green-100 text-green-700 rounded">
          Stream created successfully!
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Receiver Address</label>
        <input
          type="text"
          value={form.receiver}
          onChange={e => setForm(prev => ({ ...prev, receiver: e.target.value }))}
          placeholder="G..."
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Token Address</label>
        <input
          type="text"
          value={form.token}
          onChange={e => setForm(prev => ({ ...prev, token: e.target.value }))}
          placeholder="C..."
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Total Amount</label>
        <input
          type="number"
          value={form.totalAmount}
          onChange={e => setForm(prev => ({ ...prev, totalAmount: e.target.value }))}
          placeholder="1000000000"
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Duration (days)</label>
        <input
          type="number"
          value={form.duration}
          onChange={e => setForm(prev => ({ ...prev, duration: e.target.value }))}
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Vesting Curve</label>
        <select
          value={form.curveType}
          onChange={e => setForm(prev => ({ 
            ...prev, 
            curveType: e.target.value as "Linear" | "Exponential" 
          }))}
          className="w-full px-3 py-2 border rounded"
        >
          <option value="Linear">Linear</option>
          <option value="Exponential">Exponential</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="soulbound"
          checked={form.isSoulbound}
          onChange={e => setForm(prev => ({ ...prev, isSoulbound: e.target.checked }))}
          className="rounded"
        />
        <label htmlFor="soulbound" className="text-sm">
          Soulbound (non-transferable)
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? "Creating Stream..." : "Create Stream"}
      </button>
    </form>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

export default function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-900">StellarStream</h1>
              <WalletConnect />
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <StreamDashboard />
            </div>
            <div>
              <CreateStream />
            </div>
          </div>
        </main>
      </div>
    </WalletProvider>
  );
}
