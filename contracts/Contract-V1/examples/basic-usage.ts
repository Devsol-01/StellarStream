/**
 * StellarStream Basic Usage Example
 * 
 * This example demonstrates how to:
 * 1. Connect to the StellarStream contract
 * 2. Create a stream
 * 3. Withdraw from a stream
 * 4. Query stream details
 */

import { Contract, rpc as SorobanRpc, Address, u64, i128 } from "@stellar/stellar-sdk";
import { isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";

// Configuration
const RPC_URL = "https://soroban-rpc.stellar.org";
const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const CONTRACT_ID = process.env.STELLARSTREAM_CONTRACT_ID || "";

// Initialize RPC server
const rpcServer = new SorobanRpc.Server(RPC_URL);

// Initialize contract
const contract = new Contract(CONTRACT_ID);

/**
 * Connect wallet using Freighter
 */
export async function connectWallet(): Promise<string> {
  const connected = await isConnected();
  if (!connected) {
    throw new Error("Wallet not connected");
  }
  const address = await requestAccess();
  return address;
}

/**
 * Create a new stream
 */
export async function createStream(
  sender: string,
  receiver: string,
  token: string,
  totalAmount: bigint,
  durationDays: number
): Promise<bigint> {
  const now = Math.floor(Date.now() / 1000);
  const durationInSeconds = durationDays * 24 * 60 * 60;

  const result = await rpcServer.invokeContractFunction(
    contract,
    "create_stream",
    [
      new Address(sender),
      new Address(receiver),
      new Address(token),
      i128(totalAmount),
      u64(now),
      u64(now + durationInSeconds),
      0, // Linear curve
      false // Not soulbound
    ],
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  return BigInt(result.toString());
}

/**
 * Withdraw from a stream
 */
export async function withdraw(
  streamId: bigint,
  receiver: string
): Promise<bigint> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "withdraw",
    [
      u64(streamId),
      new Address(receiver)
    ],
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  return BigInt(result.toString());
}

/**
 * Get stream details
 */
export async function getStream(streamId: bigint) {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_stream",
    [u64(streamId)],
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  return result;
}

/**
 * Get withdrawable amount
 */
export async function getWithdrawableAmount(streamId: bigint): Promise<bigint> {
  const result = await rpcServer.invokeContractFunction(
    contract,
    "get_withdrawable_amount",
    [u64(streamId)],
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  return BigInt(result.toString());
}

/**
 * Main function demonstrating basic usage
 */
async function main() {
  try {
    // 1. Connect wallet
    console.log("Connecting wallet...");
    const userAddress = await connectWallet();
    console.log("Connected:", userAddress);

    // 2. Create a stream (100 tokens over 30 days)
    console.log("\nCreating stream...");
    const streamId = await createStream(
      userAddress,
      "G...", // Receiver address
      "C...", // Token address
      BigInt(1000000000), // 100 tokens (7 decimals)
      30 // 30 days
    );
    console.log("Stream created:", streamId.toString());

    // 3. Get stream details
    console.log("\nFetching stream details...");
    const stream = await getStream(streamId);
    console.log("Stream:", stream);

    // 4. Check withdrawable amount
    console.log("\nChecking withdrawable amount...");
    const withdrawable = await getWithdrawableAmount(streamId);
    console.log("Withdrawable:", withdrawable.toString());

    // 5. Withdraw (if available)
    if (withdrawable > BigInt(0)) {
      console.log("\nWithdrawing...");
      const withdrawn = await withdraw(streamId, userAddress);
      console.log("Withdrawn:", withdrawn.toString());
    }

    console.log("\n✓ Example completed successfully!");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the example
if (require.main === module) {
  main();
}
