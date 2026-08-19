import dotenv from "dotenv";

dotenv.config();

export interface Config {
  stellar: {
    networkUrl: string;
    passphrase: string;
  };
  contracts: {
    splitter: string;
    streamV1: string;
    streamV2: string;
  };
  server: {
    port: number;
  };
  database: {
    url: string;
  };
  refresh: {
    indexerIntervalSeconds: number;
    alertCheckIntervalSeconds: number;
  };
  alerts: {
    webhookUrl: string;
    tvlDropPercentThreshold: number;
    errorRateThreshold: number;
    maxAlertsPerMetricPerHour: number;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

export const config: Config = {
  stellar: {
    networkUrl: optionalEnv("STELLAR_NETWORK_URL", "https://soroban-testnet.stellar.org"),
    passphrase: optionalEnv("STELLAR_PASSPHRASE", "Test SDF Network ; September 2015"),
  },
  contracts: {
    splitter: optionalEnv("CONTRACT_ID_SPLITTER", ""),
    streamV1: optionalEnv("CONTRACT_ID_STREAM_V1", ""),
    streamV2: optionalEnv("CONTRACT_ID_STREAM_V2", ""),
  },
  server: {
    port: optionalInt("PORT", 3456),
  },
  database: {
    url: optionalEnv("DATABASE_URL", "file:./dev.db"),
  },
  refresh: {
    indexerIntervalSeconds: optionalInt("REFRESH_INTERVAL_SECONDS", 5),
    alertCheckIntervalSeconds: optionalInt("ALERT_CHECK_INTERVAL_SECONDS", 60),
  },
  alerts: {
    webhookUrl: optionalEnv("ALERT_WEBHOOK_URL", ""),
    tvlDropPercentThreshold: optionalInt("TVL_DROP_PERCENT_THRESHOLD", 5),
    errorRateThreshold: optionalInt("ERROR_RATE_THRESHOLD", 10),
    maxAlertsPerMetricPerHour: optionalInt("MAX_ALERTS_PER_METRIC_HOUR", 1),
  },
};

export const CONTRACT_IDS: string[] = [
  config.contracts.splitter,
  config.contracts.streamV1,
  config.contracts.streamV2,
].filter((id) => id.length > 0);

export const EVENT_TYPES = {
  SPLIT_EXEC: "splitexec",
  PAY_SENT: "paysent",
  INDIV_PAY: "indivpay",
  SCHEDULED: "sched",
  CANCEL: "cancel",
  CLAIMED: "claimed",
  AFFILIATE: "affiliate",
  ADMIN_PROPOSAL: "admprop",
  SET_STATE: "setstate",
  VERIFIED: "verified",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
