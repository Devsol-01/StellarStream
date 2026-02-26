/**
 * Type definitions for Stellar event watcher service
 */

import { SorobanRpc } from "@stellar/stellar-sdk";

/**
 * Configuration for the event watcher service
 */
export interface EventWatcherConfig {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  contractId: string;
  pollIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Parsed event data from Stellar contract
 */
export interface ParsedContractEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topics: string[];
  value: unknown;
  txHash: string;
  inSuccessfulContractCall: boolean;
}

/**
 * Service state for tracking cursor position
 */
export interface WatcherState {
  lastProcessedLedger: number;
  isRunning: boolean;
  errorCount: number;
  lastError?: Error;
  ledgersSinceLastVerification: number;
  lastVerifiedLedger: number;
}

/**
 * Event filter criteria
 */
export interface EventFilter {
  contractIds: string[];
  topics?: string[][];
  type?: SorobanRpc.Api.EventType;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
}
