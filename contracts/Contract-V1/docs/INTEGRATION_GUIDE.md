# StellarStream Developer Integration Guide

**Version:** 0.1.0  
**Last Updated:** August 2026  
**Difficulty:** High

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [SDK Setup and Installation](#sdk-setup-and-installation)
4. [Contract Instantiation](#contract-instantiation)
5. [Core Contract Functions](#core-contract-functions)
6. [Frontend Integration Patterns](#frontend-integration-patterns)
7. [Backend Integration Patterns](#backend-integration-patterns)
8. [Transaction Handling](#transaction-handling)
9. [Error Handling](#error-handling)
10. [Event Listening](#event-listening)
11. [Security Best Practices](#security-best-practices)
12. [Testing Integration](#testing-integration)
13. [Advanced Features](#advanced-features)
14. [Example Integrations](#example-integrations)
15. [Troubleshooting](#troubleshooting)
16. [API Reference](#api-reference)

---

## Introduction

StellarStream is a real-time asset streaming protocol built on Stellar/Soroban. It enables continuous token streaming from senders to receivers with features like:

- **Linear and Exponential Vesting**: Choose between proportional or accelerated unlocking
- **Multi-Signature Proposals**: Require multiple approvals for treasury streams
- **Soulbound Streams**: Identity-locked streams that cannot be transferred
- **OFAC Compliance**: Built-in restricted address management
- **Pause/Resume**: Emergency controls for stream management
- **Yield Integration**: Optional vault integration for interest distribution

### What You'll Learn

This guide covers everything you need to integrate StellarStream into your applications:

- Setting up the SDK in TypeScript and Rust
- Connecting wallets and authenticating users
- Creating, querying, and managing streams
- Handling transactions and errors
- Implementing security best practices
- Testing your integration

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ (for TypeScript/JavaScript projects)
- **Rust** 1.70+ (for contract development)
- **Stellar CLI** (for contract deployment)
- **Freighter Wallet** or another Soroban-compatible wallet
- Basic understanding of Stellar and Soroban concepts

### Required Packages

```bash
# TypeScript/JavaScript
npm install @stellar/stellar-sdk @stellar/freighter-api

# Or with Yarn
yarn add @stellar/stellar-sdk @stellar/freighter-api
```

---

## SDK Setup and Installation

### TypeScript/JavaScript Setup

#### 1. Install Dependencies

```bash
# Core SDK packages
npm install @stellar/stellar-sdk
npm install @stellar/freighter-api

# Optional: For React projects
npm install react react-dom

# Optional: For utility functions
npm install bignumber.js date-fns
```

#### 2. Configure Environment Variables

Create a `.env.local` file in your project root:

```env
# Stellar Network Configuration
NEXT_PUBLIC_STELLAR_NETWORK=public
NEXT_PUBLIC_RPC_URL=https://soroban-rpc.stellar.org
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org

# Contract Configuration
NEXT_PUBLIC_STELLARSTREAM_CONTRACT_ID=YOUR_CONTRACT_ID_HERE
NEXT_PUBLIC_STELLARSTREAM_V2_CONTRACT_ID=YOUR_V2_CONTRACT_ID_HERE

# Optional: For custom networks
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

#### 3. Initialize the SDK

```typescript
// lib/stellar.ts
import { rpc as SorobanRpc, Server, Contract } from "@stellar/stellar-sdk";
import { isConnected, getAddress, requestAccess } from "@stellar/freighter-api";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-rpc.stellar.org";
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || 
  "Public Global Stellar Network ; September 2015";

export const rpcServer = new SorobanRpc.Server(RPC_URL);

export const networkPassphrase = NETWORK_PASSPHRASE;

export const CONTRACT_ID = process.env.NEXT_PUBLIC_STELLARSTREAM_CONTRACT_ID || "";
export const CONTRACT_ID_V2 = process.env.NEXT_PUBLIC_STELLARSTREAM_V2_CONTRACT_ID || "";
```

### Rust Setup (for Contract Development)

#### 1. Install Soroban CLI

```bash
# Install Soroban CLI
cargo install --locked soroban-cli

# Or update if already installed
cargo install --locked soroban-cli --force
```

#### 2. Configure Cargo.toml

```toml
[dependencies]
soroban-sdk = "21.0.0"

[dev-dependencies]
soroban-sdk = { version = "21.0.0", features = ["testutils"] }
```

#### 3. Build the Contract

```bash
# Build for WASM target
stellar contract build

# Or manually
cargo build --target wasm32-unknown-unknown --release
```

---

## Contract Instantiation

### Deploying the Contract

```bash
# 1. Build the contract
stellar contract build

# 2. Deploy to network
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source YOUR_SECRET_KEY \
  --network public

# 3. Initialize the contract
stellar contract invoke \
  --id YOUR_CONTRACT_ID \
  --source YOUR_SECRET_KEY \
  --network public \
  -- initialize
```

### Connecting to Deployed Contract

```typescript
// lib/stellarstream-client.ts
import { Contract, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { rpcServer, networkPassphrase, CONTRACT_ID } from "./stellar";

export class StellarStreamClient {
  private contract: Contract;
  private server: SorobanRpc.Server;

  constructor(contractId: string = CONTRACT_ID) {
    this.contract = new Contract(contractId);
    this.server = rpcServer;
  }

  /**
   * Get the current contract version
   */
  async getVersion(): Promise<string> {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_version",
      [],
      { networkPassphrase }
    );
    return result.toString();
  }

  /**
   * Get contract metadata
   */
  async getMetadata() {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_metadata",
      [],
      { networkPassphrase }
    );
    return result;
  }
}

export const stellarStream = new StellarStreamClient();
```

---

## Core Contract Functions

### Stream Management

#### Creating a Stream

```typescript
import { Contract, rpc as SorobanRpc, Address, u64, i128 } from "@stellar/stellar-sdk";

interface CreateStreamParams {
  sender: string;
  receiver: string;
  token: string;
  totalAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  curveType?: "Linear" | "Exponential";
  isSoulbound?: boolean;
}

export async function createStream(params: CreateStreamParams): Promise<bigint> {
  const {
    sender,
    receiver,
    token,
    totalAmount,
    startTime,
    endTime,
    curveType = "Linear",
    isSoulbound = false
  } = params;

  // Validate parameters
  if (startTime >= endTime) {
    throw new Error("Start time must be before end time");
  }
  if (totalAmount <= 0) {
    throw new Error("Total amount must be positive");
  }

  // Build contract arguments
  const curveTypeValue = curveType === "Linear" ? 0 : 1;

  const result = await rpcServer.invokeContractFunction(
    contract,
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
    { networkPassphrase }
  );

  return BigInt(result.toString());
}
```

#### Withdrawing from a Stream

```typescript
interface WithdrawParams {
  streamId: bigint;
  receiver: string;
}

export async function withdrawFromStream(params: WithdrawParams): Promise<bigint> {
  const { streamId, receiver } = params;

  const result = await rpcServer.invokeContractFunction(
    contract,
    "withdraw",
    [
      u64(streamId),
      new Address(receiver)
    ],
    { networkPassphrase }
  );

  return BigInt(result.toString());
}
```

#### Cancelling a Stream

```typescript
interface CancelStreamParams {
  streamId: bigint;
  sender: string;
}

export async function cancelStream(params: CancelStreamParams): Promise<void> {
  const { streamId, sender } = params;

  await rpcServer.invokeContractFunction(
    contract,
    "cancel_stream",
    [
      u64(streamId),
      new Address(sender)
    ],
    { networkPassphrase }
  );
}
```

#### Pausing and Resuming a Stream

```typescript
export async function pauseStream(streamId: bigint, caller: string): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "pause_stream",
    [
      u64(streamId),
      new Address(caller)
    ],
    { networkPassphrase }
  );
}

export async function resumeStream(streamId: bigint, caller: string): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "resume_stream",
    [
      u64(streamId),
      new Address(caller)
    ],
    { networkPassphrase }
  );
}
```

### Query Functions

#### Getting Stream Details

```typescript
import { Stream } from "./types";

export async function getStream(streamId: bigint): Promise<Stream> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_stream",
    [u64(streamId)],
    { networkPassphrase }
  );

  return parseStream(result);
}

function parseStream(data: any): Stream {
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
    pausedTime: BigInt(data.paused_time || 0),
    curveType: data.curve_type === 0 ? "Linear" : "Exponential",
    interestStrategy: data.interest_strategy || 0
  };
}
```

#### Getting Withdrawable Amount

```typescript
export async function getWithdrawableAmount(streamId: bigint): Promise<bigint> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_withdrawable_amount",
    [u64(streamId)],
    { networkPassphrase }
  );

  return BigInt(result.toString());
}
```

#### Getting User's Streams

```typescript
export async function getUserStreams(userAddress: string): Promise<bigint[]> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_user_streams",
    [new Address(userAddress)],
    { networkPassphrase }
  );

  return result.map((id: any) => BigInt(id.toString()));
}
```

### Multi-Signature Proposals

#### Creating a Proposal

```typescript
interface CreateProposalParams {
  sender: string;
  receiver: string;
  token: string;
  totalAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  requiredApprovals: number;
  deadline: bigint;
}

export async function createProposal(params: CreateProposalParams): Promise<bigint> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "create_proposal",
    [
      new Address(params.sender),
      new Address(params.receiver),
      new Address(params.token),
      i128(params.totalAmount),
      u64(params.startTime),
      u64(params.endTime),
      params.requiredApprovals,
      u64(params.deadline)
    ],
    { networkPassphrase }
  );

  return BigInt(result.toString());
}
```

#### Approving a Proposal

```typescript
export async function approveProposal(
  proposalId: bigint,
  approver: string
): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "approve_proposal",
    [
      u64(proposalId),
      new Address(approver)
    ],
    { networkPassphrase }
  );
}
```

### RBAC Functions

#### Granting and Revoking Roles

```typescript
type Role = "Admin" | "Pauser" | "TreasuryManager";

export async function grantRole(
  target: string,
  role: Role,
  admin: string
): Promise<void> {
  const roleValue = role === "Admin" ? 0 : role === "Pauser" ? 1 : 2;

  await rpcServer.invokeContractFunction(
    contract,
    "grant_role",
    [
      new Address(admin),
      new Address(target),
      roleValue
    ],
    { networkPassphrase }
  );
}

export async function revokeRole(
  target: string,
  role: Role,
  admin: string
): Promise<void> {
  const roleValue = role === "Admin" ? 0 : role === "Pauser" ? 1 : 2;

  await rpcServer.invokeContractFunction(
    contract,
    "revoke_role",
    [
      new Address(admin),
      new Address(target),
      roleValue
    ],
    { networkPassphrase }
  );
}
```

#### Checking Roles

```typescript
export async function checkRole(
  address: string,
  role: Role
): Promise<boolean> {
  const roleValue = role === "Admin" ? 0 : role === "Pauser" ? 1 : 2;

  const result = await rpcServer.invokeContractFunction(
    contract,
    "check_role",
    [
      new Address(address),
      roleValue
    ],
    { networkPassphrase }
  );

  return Boolean(result);
}
```

### OFAC Compliance Functions

#### Managing Restricted Addresses

```typescript
export async function restrictAddress(
  target: string,
  admin: string
): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "restrict_address",
    [
      new Address(admin),
      new Address(target)
    ],
    { networkPassphrase }
  );
}

export async function unrestrictAddress(
  target: string,
  admin: string
): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "unrestrict_address",
    [
      new Address(admin),
      new Address(target)
    ],
    { networkPassphrase }
  );
}

export async function isAddressRestricted(address: string): Promise<boolean> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "is_address_restricted",
    [new Address(address)],
    { networkPassphrase }
  );

  return Boolean(result);
}

export async function getRestrictedAddresses(): Promise<string[]> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_restricted_addresses",
    [],
    { networkPassphrase }
  );

  return result.map((addr: any) => addr.toString());
}
```

---

## Frontend Integration Patterns

### React Integration

#### Wallet Connection Component

```tsx
// components/WalletConnect.tsx
"use client";

import React, { useState, useEffect } from "react";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";

interface WalletState {
  connected: boolean;
  address: string | null;
  network: string | null;
  loading: boolean;
  error: string | null;
}

export function WalletConnect() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    network: null,
    loading: false,
    error: null
  });

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const connected = await isConnected();
      if (connected) {
        const address = await getAddress();
        const network = await getNetwork();
        setWallet({
          connected: true,
          address,
          network: network.network,
          loading: false,
          error: null
        });
      }
    } catch (error) {
      console.error("Failed to check wallet connection:", error);
    }
  };

  const connect = async () => {
    setWallet(prev => ({ ...prev, loading: true, error: null }));
    try {
      const address = await requestAccess();
      const network = await getNetwork();
      setWallet({
        connected: true,
        address,
        network: network.network,
        loading: false,
        error: null
      });
    } catch (error) {
      setWallet(prev => ({
        ...prev,
        loading: false,
        error: "Failed to connect wallet"
      }));
    }
  };

  const disconnect = () => {
    setWallet({
      connected: false,
      address: null,
      network: null,
      loading: false,
      error: null
    });
  };

  if (wallet.connected) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {wallet.address?.slice(0, 8)}...{wallet.address?.slice(-8)}
        </span>
        <span className="text-xs text-gray-400">
          {wallet.network}
        </span>
        <button
          onClick={disconnect}
          className="px-4 py-2 text-sm bg-red-500 text-white rounded"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={wallet.loading}
      className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
    >
      {wallet.loading ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
```

#### Stream Dashboard Component

```tsx
// components/StreamDashboard.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useWallet } from "@/lib/wallet-context";
import { getStream, getWithdrawableAmount, withdrawFromStream } from "@/lib/stellarstream";
import { Stream } from "@/lib/types";

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
      // Fetch user's stream IDs
      const streamIds = await getUserStreams(address!);
      
      // Fetch stream details
      const streamDetails = await Promise.all(
        streamIds.map(id => getStream(id))
      );
      
      setStreams(streamDetails);
    } catch (err) {
      setError("Failed to load streams");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (streamId: bigint) => {
    try {
      await withdrawFromStream({ streamId, receiver: address! });
      await loadStreams(); // Refresh
    } catch (err) {
      setError("Failed to withdraw");
      console.error(err);
    }
  };

  if (!isConnected) {
    return <div>Please connect your wallet</div>;
  }

  if (loading) {
    return <div>Loading streams...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Your Streams</h2>
      {streams.length === 0 ? (
        <p>No streams found</p>
      ) : (
        <div className="grid gap-4">
          {streams.map((stream) => (
            <StreamCard
              key={stream.streamId.toString()}
              stream={stream}
              onWithdraw={() => handleWithdraw(stream.streamId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StreamCard({ stream, onWithdraw }: { stream: Stream; onWithdraw: () => void }) {
  const [withdrawable, setWithdrawable] = useState<bigint>(BigInt(0));

  useEffect(() => {
    const fetchWithdrawable = async () => {
      const amount = await getWithdrawableAmount(stream.streamId);
      setWithdrawable(amount);
    };
    fetchWithdrawable();
  }, [stream.streamId]);

  const progress = Number(stream.withdrawn * BigInt(100) / stream.totalAmount);
  const isActive = !stream.cancelled && !stream.isPaused;

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
          isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
        }`}>
          {isActive ? "Active" : stream.isPaused ? "Paused" : "Cancelled"}
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
          onClick={onWithdraw}
          disabled={withdrawable === BigInt(0)}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}
```

#### Stream Creation Component

```tsx
// components/CreateStream.tsx
"use client";

import React, { useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { createStream } from "@/lib/stellarstream";

interface CreateStreamForm {
  receiver: string;
  token: string;
  totalAmount: string;
  duration: string;
  curveType: "Linear" | "Exponential";
  isSoulbound: boolean;
}

export function CreateStream() {
  const { address, isConnected } = useWallet();
  const [form, setForm] = useState<CreateStreamForm>({
    receiver: "",
    token: "",
    totalAmount: "",
    duration: "30", // days
    curveType: "Linear",
    isSoulbound: false
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
      
      const streamId = await createStream({
        sender: address,
        receiver: form.receiver,
        token: form.token,
        totalAmount: BigInt(form.totalAmount),
        startTime: BigInt(now),
        endTime: BigInt(now + durationInSeconds),
        curveType: form.curveType,
        isSoulbound: form.isSoulbound
      });

      setSuccess(true);
      console.log("Stream created:", streamId.toString());
    } catch (err: any) {
      setError(err.message || "Failed to create stream");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return <div>Please connect your wallet to create a stream</div>;
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
          onChange={(e) => setForm(prev => ({ ...prev, receiver: e.target.value }))}
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
          onChange={(e) => setForm(prev => ({ ...prev, token: e.target.value }))}
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
          onChange={(e) => setForm(prev => ({ ...prev, totalAmount: e.target.value }))}
          placeholder="1000000000" // 100 tokens with 7 decimals
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Duration (days)</label>
        <input
          type="number"
          value={form.duration}
          onChange={(e) => setForm(prev => ({ ...prev, duration: e.target.value }))}
          className="w-full px-3 py-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Vesting Curve</label>
        <select
          value={form.curveType}
          onChange={(e) => setForm(prev => ({ 
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
          onChange={(e) => setForm(prev => ({ ...prev, isSoulbound: e.target.checked }))}
          className="rounded"
        />
        <label htmlFor="soulbound" className="text-sm">
          Soulbound (non-transferable)
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {loading ? "Creating Stream..." : "Create Stream"}
      </button>
    </form>
  );
}
```

### Next.js Integration

#### API Route for Stream Queries

```typescript
// app/api/streams/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStream, getUserStreams } from "@/lib/stellarstream";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const streamId = searchParams.get("streamId");
  const userAddress = searchParams.get("user");

  try {
    if (streamId) {
      const stream = await getStream(BigInt(streamId));
      return NextResponse.json({ stream });
    }

    if (userAddress) {
      const streamIds = await getUserStreams(userAddress);
      const streams = await Promise.all(
        streamIds.map(id => getStream(id))
      );
      return NextResponse.json({ streams });
    }

    return NextResponse.json(
      { error: "Missing streamId or user parameter" },
      { status: 400 }
    );
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

#### Server-Side Stream Data Fetching

```typescript
// app/streams/[id]/page.tsx
import { getStream, getWithdrawableAmount } from "@/lib/stellarstream";
import { StreamDetails } from "@/components/StreamDetails";

export default async function StreamPage({ params }: { params: { id: string } }) {
  const streamId = BigInt(params.id);
  
  // Fetch stream data on server
  const stream = await getStream(streamId);
  const withdrawable = await getWithdrawableAmount(streamId);

  return (
    <StreamDetails stream={stream} withdrawable={withdrawable} />
  );
}
```

---

## Backend Integration Patterns

### Node.js Backend Setup

#### 1. Install Dependencies

```bash
npm install @stellar/stellar-sdk express dotenv
npm install -D @types/express typescript ts-node
```

#### 2. Create StellarStream Service

```typescript
// services/stellarstream.service.ts
import { Contract, rpc as SorobanRpc, Address, u64, i128 } from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL || "https://soroban-rpc.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 
  "Public Global Stellar Network ; September 2015";
const CONTRACT_ID = process.env.STELLARSTREAM_CONTRACT_ID || "";

export class StellarStreamService {
  private server: SorobanRpc.Server;
  private contract: Contract;

  constructor() {
    this.server = new SorobanRpc.Server(RPC_URL);
    this.contract = new Contract(CONTRACT_ID);
  }

  async getStream(streamId: bigint) {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_stream",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );
    return this.parseStream(result);
  }

  async getUserStreams(userAddress: string) {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_user_streams",
      [new Address(userAddress)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );
    return result.map((id: any) => BigInt(id.toString()));
  }

  async getWithdrawableAmount(streamId: bigint) {
    const result = await this.server.invokeContractFunction(
      this.contract,
      "get_withdrawable_amount",
      [u64(streamId)],
      { networkPassphrase: NETWORK_PASSPHRASE }
    );
    return BigInt(result.toString());
  }

  private parseStream(data: any) {
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
      pausedTime: BigInt(data.paused_time || 0),
      curveType: data.curve_type === 0 ? "Linear" : "Exponential",
      interestStrategy: data.interest_strategy || 0
    };
  }
}

export const stellarStreamService = new StellarStreamService();
```

#### 3. Create Express API

```typescript
// routes/streams.routes.ts
import { Router, Request, Response } from "express";
import { stellarStreamService } from "../services/stellarstream.service";

const router = Router();

// Get stream by ID
router.get("/streams/:id", async (req: Request, res: Response) => {
  try {
    const streamId = BigInt(req.params.id);
    const stream = await stellarStreamService.getStream(streamId);
    res.json({ stream });
  } catch (error) {
    console.error("Error fetching stream:", error);
    res.status(500).json({ error: "Failed to fetch stream" });
  }
});

// Get user's streams
router.get("/streams/user/:address", async (req: Request, res: Response) => {
  try {
    const streamIds = await stellarStreamService.getUserStreams(req.params.address);
    const streams = await Promise.all(
      streamIds.map(id => stellarStreamService.getStream(id))
    );
    res.json({ streams });
  } catch (error) {
    console.error("Error fetching user streams:", error);
    res.status(500).json({ error: "Failed to fetch user streams" });
  }
});

// Get withdrawable amount
router.get("/streams/:id/withdrawable", async (req: Request, res: Response) => {
  try {
    const streamId = BigInt(req.params.id);
    const amount = await stellarStreamService.getWithdrawableAmount(streamId);
    res.json({ amount: amount.toString() });
  } catch (error) {
    console.error("Error fetching withdrawable amount:", error);
    res.status(500).json({ error: "Failed to fetch withdrawable amount" });
  }
});

export default router;
```

#### 4. Create Express App

```typescript
// app.ts
import express from "express";
import dotenv from "dotenv";
import streamsRouter from "./routes/streams.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Routes
app.use("/api", streamsRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
```

---

## Transaction Handling

### Building Transactions

```typescript
import { TransactionBuilder, Operation, networks } from "@stellar/stellar-sdk";

interface TransactionOptions {
  source: string;
  networkPassphrase: string;
  fee?: string;
  memo?: string;
}

export async function buildStreamTransaction(
  contractId: string,
  method: string,
  args: any[],
  options: TransactionOptions
) {
  // Get account info
  const account = await rpcServer.getAccount(options.source);
  
  // Get recent ledger to set sequence number
  const { sequence } = account;

  // Build transaction
  const transaction = new TransactionBuilder(account, {
    fee: options.fee || "100", // 0.001 XLM
    networkPassphrase: options.networkPassphrase
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        method,
        args
      })
    )
    .setTimeout(300) // 5 minutes
    .build();

  // Add memo if provided
  if (options.memo) {
    transaction.addMemo(Memo.text(options.memo));
  }

  return transaction;
}
```

### Signing and Submitting Transactions

```typescript
import { signTransaction } from "@stellar/freighter-api";

export async function signAndSubmitTransaction(
  transaction: Transaction,
  source: string
): Promise<string> {
  try {
    // Sign transaction with Freighter
    const signedTx = await signTransaction(transaction.toXDR(), {
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "public"
    });

    // Submit to network
    const result = await rpcServer.sendTransaction(
      TransactionBuilder.fromXDR(signedTx)
    );

    if (result.status === "ERROR") {
      throw new Error(`Transaction failed: ${result.error}`);
    }

    return result.hash;
  } catch (error) {
    console.error("Transaction submission failed:", error);
    throw error;
  }
}
```

### Handling Transaction Results

```typescript
interface TransactionResult {
  hash: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  ledger?: number;
  error?: string;
}

export async function submitAndWaitForConfirmation(
  transaction: Transaction
): Promise<TransactionResult> {
  try {
    // Sign the transaction
    const signedTx = await signTransaction(transaction.toXDR(), {
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "public"
    });

    // Submit to network
    const result = await rpcServer.sendTransaction(
      TransactionBuilder.fromXDR(signedTx)
    );

    if (result.status === "ERROR") {
      return {
        hash: result.hash,
        status: "FAILED",
        error: result.error
      };
    }

    // Wait for confirmation
    const confirmedResult = await rpcServer.waitForTransaction(result.hash);

    return {
      hash: result.hash,
      status: "SUCCESS",
      ledger: confirmedResult.ledger
    };
  } catch (error: any) {
    return {
      hash: "",
      status: "FAILED",
      error: error.message
    };
  }
}
```

---

## Error Handling

### Error Types

```typescript
export enum StellarStreamError {
  // Contract errors
  AlreadyInitialized = 1,
  InvalidTimeRange = 2,
  InvalidAmount = 3,
  StreamNotFound = 4,
  Unauthorized = 5,
  AlreadyCancelled = 6,
  InsufficientBalance = 7,
  ProposalNotFound = 8,
  ProposalExpired = 9,
  AlreadyApproved = 10,
  ProposalAlreadyExecuted = 11,
  InvalidApprovalThreshold = 12,
  
  // Stream state errors
  StreamNotFound = 13,
  StreamPaused = 14,
  StreamIsSoulbound = 21,
  AddressRestricted = 22,
  StreamNotPaused = 26,
  
  // Network errors
  NetworkError = 1000,
  TimeoutError = 1001,
  InsufficientFunds = 1002
}
```

### Error Handling Utility

```typescript
export class StellarStreamErrorHandler {
  static handleError(error: any): string {
    // Check if it's a contract error
    if (error.message?.includes("ContractError")) {
      return this.handleContractError(error);
    }

    // Check if it's a network error
    if (error.message?.includes("NetworkError") || error.code === "ECONNREFUSED") {
      return this.handleNetworkError(error);
    }

    // Check if it's a transaction error
    if (error.message?.includes("TransactionFailed")) {
      return this.handleTransactionError(error);
    }

    // Generic error
    return `An unexpected error occurred: ${error.message}`;
  }

  private static handleContractError(error: any): string {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes("streamnotfound")) {
      return "Stream not found. Please check the stream ID.";
    }
    
    if (errorMessage.includes("unauthorized")) {
      return "You are not authorized to perform this action.";
    }
    
    if (errorMessage.includes("invalidamount")) {
      return "Invalid amount. Please enter a positive value.";
    }
    
    if (errorMessage.includes("streampaused")) {
      return "This stream is currently paused.";
    }
    
    if (errorMessage.includes("streamissoulbound")) {
      return "This stream is soulbound and cannot be transferred.";
    }
    
    if (errorMessage.includes("addressrestricted")) {
      return "This address is restricted and cannot receive streams.";
    }
    
    return `Contract error: ${error.message}`;
  }

  private static handleNetworkError(error: any): string {
    return "Network error. Please check your connection and try again.";
  }

  private static handleTransactionError(error: any): string {
    if (error.message?.includes("timeout")) {
      return "Transaction timed out. Please try again.";
    }
    
    if (error.message?.includes("insufficient")) {
      return "Insufficient funds to complete this transaction.";
    }
    
    return `Transaction failed: ${error.message}`;
  }
}
```

### Retry Logic

```typescript
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (this.shouldNotRetry(error)) {
        throw error;
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError || new Error("Operation failed after all retries");
}

private shouldNotRetry(error: any): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("unauthorized") ||
    message.includes("streamnotfound") ||
    message.includes("invalidamount") ||
    message.includes("streamissoulbound")
  );
}
```

---

## Event Listening

### Stellar Event System

StellarStream emits events for key operations. You can listen to these events to build reactive applications.

#### Event Types

```typescript
export enum StreamEventType {
  StreamCreated = "stream_created",
  StreamCancelled = "stream_cancelled",
  StreamPaused = "stream_paused",
  StreamResumed = "stream_resumed",
  Withdrawal = "withdrawal",
  ProposalCreated = "proposal_created",
  ProposalApproved = "proposal_approved",
  RoleGranted = "role_granted",
  RoleRevoked = "role_revoked"
}

export interface StreamEvent {
  type: StreamEventType;
  streamId?: bigint;
  sender?: string;
  receiver?: string;
  amount?: bigint;
  timestamp: number;
}
```

#### Event Listener Implementation

```typescript
import { EventSource, EventSourceEvent } from "@stellar/stellar-sdk";

export class StreamEventListener {
  private eventSource: EventSource;
  private listeners: Map<StreamEventType, Function[]> = new Map();

  constructor(contractId: string, rpcUrl: string) {
    this.eventSource = new EventSource(rpcUrl, {
      contractId,
      networkPassphrase: NETWORK_PASSPHRASE
    });
  }

  start() {
    this.eventSource.addEventListener("message", (event: EventSourceEvent) => {
      this.handleEvent(event);
    });

    this.eventSource.addEventListener("error", (error: Event) => {
      console.error("Event source error:", error);
    });
  }

  stop() {
    this.eventSource.close();
  }

  on(eventType: StreamEventType, callback: Function) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(callback);
  }

  off(eventType: StreamEventType, callback: Function) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private handleEvent(event: EventSourceEvent) {
    try {
      const data = JSON.parse(event.data);
      const streamEvent = this.parseEvent(data);
      
      if (streamEvent) {
        this.emit(streamEvent.type, streamEvent);
      }
    } catch (error) {
      console.error("Failed to parse event:", error);
    }
  }

  private parseEvent(data: any): StreamEvent | null {
    // Parse event based on topic
    const topic = data.topic?.[0];
    
    switch (topic) {
      case "create_stream":
        return {
          type: StreamEventType.StreamCreated,
          streamId: BigInt(data.data?.stream_id),
          sender: data.data?.sender,
          receiver: data.data?.receiver,
          amount: BigInt(data.data?.amount),
          timestamp: Date.now()
        };
      
      case "withdraw":
        return {
          type: StreamEventType.Withdrawal,
          streamId: BigInt(data.data?.stream_id),
          receiver: data.data?.receiver,
          amount: BigInt(data.data?.amount),
          timestamp: Date.now()
        };
      
      // Add other event types...
      
      default:
        return null;
    }
  }

  private emit(eventType: StreamEventType, event: StreamEvent) {
    const callbacks = this.listeners.get(eventType) || [];
    callbacks.forEach(callback => callback(event));
  }
}
```

#### React Hook for Event Listening

```typescript
// hooks/useStreamEvents.ts
import { useEffect, useRef } from "react";
import { StreamEventListener, StreamEvent, StreamEventType } from "@/lib/event-listener";

export function useStreamEvents(
  contractId: string,
  eventTypes: StreamEventType[],
  callback: (event: StreamEvent) => void
) {
  const listenerRef = useRef<StreamEventListener | null>(null);

  useEffect(() => {
    if (!contractId) return;

    const listener = new StreamEventListener(
      contractId,
      process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-rpc.stellar.org"
    );

    // Register callbacks for each event type
    eventTypes.forEach(eventType => {
      listener.on(eventType, callback);
    });

    // Start listening
    listener.start();
    listenerRef.current = listener;

    return () => {
      listener.stop();
    };
  }, [contractId, eventTypes, callback]);
}

// Usage example
export function StreamEvents() {
  const handleStreamCreated = (event: StreamEvent) => {
    console.log("New stream created:", event.streamId);
  };

  const handleWithdrawal = (event: StreamEvent) => {
    console.log("Withdrawal made:", event.amount);
  };

  useStreamEvents(
    process.env.NEXT_PUBLIC_STELLARSTREAM_CONTRACT_ID || "",
    [StreamEventType.StreamCreated, StreamEventType.Withdrawal],
    (event) => {
      switch (event.type) {
        case StreamEventType.StreamCreated:
          handleStreamCreated(event);
          break;
        case StreamEventType.Withdrawal:
          handleWithdrawal(event);
          break;
      }
    }
  );

  return null; // This component only listens to events
}
```

---

## Security Best Practices

### 1. Input Validation

```typescript
export function validateStreamParams(params: CreateStreamParams) {
  const errors: string[] = [];

  // Validate addresses
  if (!isValidStellarAddress(params.sender)) {
    errors.push("Invalid sender address");
  }
  if (!isValidStellarAddress(params.receiver)) {
    errors.push("Invalid receiver address");
  }
  if (!isValidStellarAddress(params.token)) {
    errors.push("Invalid token address");
  }

  // Validate amounts
  if (params.totalAmount <= 0) {
    errors.push("Total amount must be positive");
  }
  if (params.totalAmount > MAX_STREAM_AMOUNT) {
    errors.push("Total amount exceeds maximum");
  }

  // Validate times
  const now = Math.floor(Date.now() / 1000);
  if (params.startTime <= now) {
    errors.push("Start time must be in the future");
  }
  if (params.endTime <= params.startTime) {
    errors.push("End time must be after start time");
  }

  // Validate duration
  const duration = params.endTime - params.startTime;
  if (duration > MAX_STREAM_DURATION) {
    errors.push("Stream duration exceeds maximum");
  }

  return errors;
}

function isValidStellarAddress(address: string): boolean {
  return /^[GX][A-Z0-9]{55}$/.test(address);
}
```

### 2. Rate Limiting

```typescript
import rateLimit from "express-rate-limit";

export const streamApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

export const createStreamLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 stream creations per hour
  message: "Too many stream creations, please try again later",
});
```

### 3. Transaction Signing Security

```typescript
// Always verify transaction before signing
export async function verifyAndSignTransaction(
  transaction: Transaction
): Promise<string> {
  // 1. Verify transaction source
  if (transaction.source !== userAddress) {
    throw new Error("Transaction source mismatch");
  }

  // 2. Verify transaction operations
  const operations = transaction.operations;
  for (const op of operations) {
    if (op.type === "invokeContractFunction") {
      // Verify contract ID
      if (op.contract !== CONTRACT_ID) {
        throw new Error("Invalid contract ID");
      }

      // Verify method is allowed
      const allowedMethods = ["create_stream", "withdraw", "cancel_stream"];
      if (!allowedMethods.includes(op.method)) {
        throw new Error("Unauthorized method");
      }
    }
  }

  // 3. Sign the transaction
  return await signTransaction(transaction.toXDR(), {
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "public"
  });
}
```

### 4. Secure Key Management

```typescript
// NEVER store private keys in client-side code
// Use wallet extensions like Freighter for key management

export class SecureWalletManager {
  private address: string | null = null;

  async connect(): Promise<string> {
    // Use Freighter for secure key management
    const address = await requestAccess();
    this.address = address;
    return address;
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.address) {
      throw new Error("Wallet not connected");
    }

    // Freighter handles key security internally
    return await signTransaction(xdr, {
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "public"
    });
  }

  disconnect() {
    this.address = null;
  }
}
```

### 5. Audit Trail

```typescript
export interface AuditLog {
  timestamp: number;
  action: string;
  user: string;
  streamId?: bigint;
  details: any;
}

export class AuditTrail {
  private logs: AuditLog[] = [];

  log(
    action: string,
    user: string,
    streamId?: bigint,
    details?: any
  ) {
    this.logs.push({
      timestamp: Date.now(),
      action,
      user,
      streamId,
      details
    });
  }

  getLogs(user?: string, action?: string): AuditLog[] {
    return this.logs.filter(log => {
      if (user && log.user !== user) return false;
      if (action && log.action !== action) return false;
      return true;
    });
  }
}

export const auditTrail = new AuditTrail();
```

---

## Testing Integration

### Unit Tests

```typescript
// __tests__/stellarstream.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { StellarStreamClient } from "../lib/stellarstream-client";

describe("StellarStreamClient", () => {
  let client: StellarStreamClient;

  beforeEach(() => {
    client = new StellarStreamClient("TEST_CONTRACT_ID");
  });

  describe("getStream", () => {
    it("should fetch stream details", async () => {
      const streamId = BigInt(1);
      const stream = await client.getStream(streamId);
      
      expect(stream).toBeDefined();
      expect(stream.streamId).toBe(streamId);
    });

    it("should throw for non-existent stream", async () => {
      const streamId = BigInt(999);
      await expect(client.getStream(streamId)).rejects.toThrow("StreamNotFound");
    });
  });

  describe("createStream", () => {
    it("should create a new stream", async () => {
      const params = {
        sender: "G...",
        receiver: "G...",
        token: "C...",
        totalAmount: BigInt(1000000000),
        startTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400 * 30),
        curveType: "Linear" as const,
        isSoulbound: false
      };

      const streamId = await client.createStream(params);
      expect(streamId).toBeDefined();
      expect(streamId).toBeGreaterThan(BigInt(0));
    });

    it("should reject invalid parameters", async () => {
      const params = {
        sender: "G...",
        receiver: "G...",
        token: "C...",
        totalAmount: BigInt(-100),
        startTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        endTime: BigInt(Math.floor(Date.now() / 1000)),
        curveType: "Linear" as const,
        isSoulbound: false
      };

      await expect(client.createStream(params)).rejects.toThrow("InvalidAmount");
    });
  });

  describe("withdraw", () => {
    it("should withdraw available amount", async () => {
      const streamId = BigInt(1);
      const amount = await client.getWithdrawableAmount(streamId);
      
      if (amount > BigInt(0)) {
        const withdrawn = await client.withdraw(streamId);
        expect(withdrawn).toBe(amount);
      }
    });
  });
});
```

### Integration Tests

```typescript
// __tests__/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StellarStreamService } from "../services/stellarstream.service";

describe("StellarStream Integration", () => {
  let service: StellarStreamService;
  let testSender: string;
  let testReceiver: string;

  beforeAll(async () => {
    service = new StellarStreamService();
    // Setup test accounts
    testSender = await createTestAccount();
    testReceiver = await createTestAccount();
  });

  afterAll(async () => {
    // Cleanup test accounts
    await cleanupTestAccount(testSender);
    await cleanupTestAccount(testReceiver);
  });

  it("should complete full stream lifecycle", async () => {
    // 1. Create stream
    const streamId = await service.createStream({
      sender: testSender,
      receiver: testReceiver,
      token: TEST_TOKEN_ADDRESS,
      totalAmount: BigInt(1000000000),
      startTime: BigInt(Math.floor(Date.now() / 1000)),
      endTime: BigInt(Math.floor(Date.now() / 1000) + 86400 * 7),
      curveType: "Linear",
      isSoulbound: false
    });

    expect(streamId).toBeDefined();

    // 2. Verify stream exists
    const stream = await service.getStream(streamId);
    expect(stream.sender).toBe(testSender);
    expect(stream.receiver).toBe(testReceiver);

    // 3. Wait for some vesting
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 4. Check withdrawable amount
    const withdrawable = await service.getWithdrawableAmount(streamId);
    expect(withdrawable).toBeGreaterThan(BigInt(0));

    // 5. Withdraw
    const withdrawn = await service.withdraw(streamId);
    expect(withdrawn).toBe(withdrawable);

    // 6. Cancel stream
    await service.cancelStream(streamId);
    
    // 7. Verify stream is cancelled
    const cancelledStream = await service.getStream(streamId);
    expect(cancelledStream.cancelled).toBe(true);
  });
});
```

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.config.ts",
        "**/*.config.js"
      ]
    },
    setupFiles: ["./vitest.setup.ts"]
  }
});
```

---

## Advanced Features

### Interest Distribution

```typescript
// Configure interest strategy
export const INTEREST_STRATEGIES = {
  TO_SENDER: 0b001,      // All interest to sender
  TO_RECEIVER: 0b010,    // All interest to receiver
  TO_PROTOCOL: 0b100,    // All interest to protocol
  SPLIT_ALL: 0b111       // Equal split (33% each)
};

export async function setInterestStrategy(
  streamId: bigint,
  strategy: number,
  admin: string
): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "set_interest_strategy",
    [
      u64(streamId),
      strategy,
      new Address(admin)
    ],
    { networkPassphrase }
  );
}
```

### USD Pegging

```typescript
// Create stream with USD pegging
export interface UsdPegConfig {
  usdAmount: bigint;    // Amount in USD (7 decimals)
  minPrice: bigint;     // Minimum price for slippage protection
  maxPrice: bigint;     // Maximum price for slippage protection
  oracle: string;       // Price oracle contract address
}

export async function createUsdPeggedStream(
  params: CreateStreamParams,
  pegConfig: UsdPegConfig
): Promise<bigint> {
  // Convert USD amount to token amount using oracle
  const tokenAmount = await convertUsdToToken(
    pegConfig.usdAmount,
    pegConfig.oracle
  );

  // Create stream with converted amount
  return await createStream({
    ...params,
    totalAmount: tokenAmount
  });
}
```

### Milestone Vesting

```typescript
export interface Milestone {
  timestamp: bigint;
  percentage: number;  // Basis points (100 = 1%)
}

export async function createMilestoneStream(
  params: CreateStreamParams,
  milestones: Milestone[]
): Promise<bigint> {
  // Sort milestones by timestamp
  const sortedMilestones = milestones.sort(
    (a, b) => Number(a.timestamp - b.timestamp)
  );

  // Validate milestones
  validateMilestones(sortedMilestones, params.startTime, params.endTime);

  // Create stream with milestones
  return await rpcServer.invokeContractFunction(
    contract,
    "create_stream_with_milestones",
    [
      new Address(params.sender),
      new Address(params.receiver),
      new Address(params.token),
      i128(params.totalAmount),
      u64(params.startTime),
      u64(params.endTime),
      sortedMilestones.map(m => ({
        timestamp: u64(m.timestamp),
        percentage: m.percentage
      }))
    ],
    { networkPassphrase }
  );
}
```

### Flash Loans

```typescript
export async function executeFlashLoan(
  borrower: string,
  token: string,
  amount: bigint,
  callbackData: string
): Promise<void> {
  await rpcServer.invokeContractFunction(
    contract,
    "flash_loan",
    [
      new Address(borrower),
      new Address(token),
      i128(amount),
      Buffer.from(callbackData, "hex")
    ],
    { networkPassphrase }
  );
}
```

---

## Example Integrations

### Complete React Application

```tsx
// App.tsx
"use client";

import React from "react";
import { WalletProvider } from "./lib/wallet-context";
import { WalletConnect } from "./components/WalletConnect";
import { StreamDashboard } from "./components/StreamDashboard";
import { CreateStream } from "./components/CreateStream";
import { StreamEvents } from "./components/StreamEvents";

export default function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                StellarStream
              </h1>
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

        <StreamEvents />
      </div>
    </WalletProvider>
  );
}
```

### Node.js Backend with Express

```typescript
// server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import streamsRouter from "./routes/streams.routes";
import { stellarStreamService } from "./services/stellarstream.service";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", streamsRouter);

// WebSocket for real-time updates
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
```

### CLI Tool for Stream Management

```typescript
#!/usr/bin/env node
// cli/stellarstream-cli.ts
import { Command } from "commander";
import { StellarStreamService } from "../services/stellarstream.service";

const program = new Command();
const service = new StellarStreamService();

program
  .name("stellarstream")
  .description("StellarStream CLI tool")
  .version("0.1.0");

program
  .command("get-stream <streamId>")
  .description("Get stream details")
  .action(async (streamId: string) => {
    const stream = await service.getStream(BigInt(streamId));
    console.log(JSON.stringify(stream, null, 2));
  });

program
  .command("get-user-streams <address>")
  .description("Get user's streams")
  .action(async (address: string) => {
    const streamIds = await service.getUserStreams(address);
    console.log("Stream IDs:", streamIds.map(id => id.toString()));
  });

program
  .command("get-withdrawable <streamId>")
  .description("Get withdrawable amount")
  .action(async (streamId: string) => {
    const amount = await service.getWithdrawableAmount(BigInt(streamId));
    console.log("Withdrawable amount:", amount.toString());
  });

program.parse();
```

---

## Troubleshooting

### Common Issues

#### 1. "StreamNotFound" Error

**Cause:** Stream ID doesn't exist or is incorrect.

**Solution:**
```typescript
// Verify stream exists before operations
const streamExists = await checkStreamExists(streamId);
if (!streamExists) {
  throw new Error("Stream not found");
}
```

#### 2. "Unauthorized" Error

**Cause:** Caller doesn't have permission for the operation.

**Solution:**
```typescript
// Verify user has required role
const hasRole = await checkRole(userAddress, "Admin");
if (!hasRole) {
  throw new Error("User does not have Admin role");
}
```

#### 3. Transaction Timeout

**Cause:** Network congestion or high fee.

**Solution:**
```typescript
// Increase timeout and fee
const transaction = new TransactionBuilder(account, {
  fee: "1000", // Higher fee
  networkPassphrase
})
  .addOperation(operation)
  .setTimeout(600) // 10 minutes
  .build();
```

#### 4. Insufficient Balance

**Cause:** Not enough tokens to create stream or pay fees.

**Solution:**
```typescript
// Check balance before creating stream
const balance = await getTokenBalance(tokenAddress, senderAddress);
if (balance < totalAmount) {
  throw new Error("Insufficient token balance");
}

// Check XLM balance for fees
const xlmBalance = await getXlmBalance(senderAddress);
if (xlmBalance < BigInt(1000000)) { // 0.1 XLM
  throw new Error("Insufficient XLM for transaction fees");
}
```

#### 5. Contract Not Initialized

**Cause:** Contract hasn't been initialized after deployment.

**Solution:**
```bash
# Initialize the contract
stellar contract invoke \
  --id YOUR_CONTRACT_ID \
  --source YOUR_SECRET_KEY \
  --network public \
  -- initialize
```

### Debug Mode

```typescript
// Enable debug logging
process.env.DEBUG = "stellarstream:*";

// Log all contract interactions
const originalInvoke = rpcServer.invokeContractFunction.bind(rpcServer);
rpcServer.invokeContractFunction = async (...args) => {
  console.log("Invoking contract:", args);
  const result = await originalInvoke(...args);
  console.log("Contract result:", result);
  return result;
};
```

### Performance Optimization

```typescript
// Cache frequently accessed data
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 60 }); // 60 seconds TTL

export async function getCachedStream(streamId: bigint) {
  const cacheKey = `stream_${streamId.toString()}`;
  
  // Check cache first
  let stream = cache.get(cacheKey);
  if (stream) {
    return stream;
  }

  // Fetch from contract
  stream = await getStream(streamId);
  
  // Store in cache
  cache.set(cacheKey, stream);
  
  return stream;
}
```

---

## API Reference

### Contract Functions

#### Stream Management

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `create_stream` | sender, receiver, token, total_amount, start_time, end_time, curve_type, is_soulbound | stream_id | Create a new stream |
| `withdraw` | stream_id, receiver | amount | Withdraw unlocked tokens |
| `cancel_stream` | stream_id, sender | void | Cancel a stream |
| `pause_stream` | stream_id, caller | void | Pause a stream |
| `resume_stream` | stream_id, caller | void | Resume a paused stream |

#### Query Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `get_stream` | stream_id | Stream | Get stream details |
| `get_withdrawable_amount` | stream_id | amount | Get available balance |
| `get_user_streams` | user_address | stream_ids[] | Get user's streams |

#### Multi-Signature Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `create_proposal` | sender, receiver, token, total_amount, start_time, end_time, required_approvals, deadline | proposal_id | Create proposal |
| `approve_proposal` | proposal_id, approver | void | Approve proposal |

#### RBAC Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `grant_role` | admin, account, role | void | Grant role |
| `revoke_role` | admin, account, role | void | Revoke role |
| `check_role` | address, role | boolean | Check role |

#### OFAC Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `restrict_address` | admin, target | void | Restrict address |
| `unrestrict_address` | admin, target | void | Remove restriction |
| `is_address_restricted` | address | boolean | Check restriction |
| `get_restricted_addresses` | none | addresses[] | Get all restricted |

### Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 1 | AlreadyInitialized | Contract already initialized |
| 2 | InvalidTimeRange | start_time >= end_time |
| 3 | InvalidAmount | amount <= 0 |
| 4 | StreamNotFound | Invalid stream_id |
| 5 | Unauthorized | Missing permissions |
| 6 | AlreadyCancelled | Stream already cancelled |
| 7 | InsufficientBalance | Not enough tokens |
| 8 | ProposalNotFound | Invalid proposal_id |
| 9 | ProposalExpired | Proposal past deadline |
| 10 | AlreadyApproved | User already approved |
| 11 | ProposalAlreadyExecuted | Proposal already executed |
| 12 | InvalidApprovalThreshold | Invalid threshold |
| 13 | StreamNotFound | Stream not found |
| 14 | StreamPaused | Cannot withdraw while paused |
| 21 | StreamIsSoulbound | Transfer not allowed |
| 22 | AddressRestricted | OFAC compliance violation |
| 26 | StreamNotPaused | Cannot resume active stream |

---

## Contributing

### Development Workflow

1. Fork the repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Write tests first (TDD approach)
4. Implement functionality
5. Ensure all tests pass: `npm test`
6. Submit pull request

### Code Standards

- Follow TypeScript/JavaScript best practices
- Add comprehensive tests for new features
- Document public functions with JSDoc
- Use TypeScript strict mode
- Prefer explicit error handling over async/await without try/catch

### Testing Requirements

- Unit tests for all public functions
- Integration tests for complex workflows
- Error case coverage with proper assertions
- Performance benchmarks for gas-sensitive operations

---

## Support & Resources

### Documentation

- [User Guide](./USER_GUIDE.md)
- [API Reference](#api-reference)
- [Security Best Practices](#security-best-practices)

### Community

- GitHub Issues: Bug reports and feature requests
- Discussions: Architecture and design questions
- Discord: Real-time developer support

### Security

- Security issues: security@stellarstream.io
- Bug bounty program: Available for critical vulnerabilities

---

*Built with ❤️ for the Stellar ecosystem*
