/**
 * Structured logging utility
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL = (process.env.LOG_LEVEL || "info") as LogLevel;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", message, meta));
    }
  },

  info(message: string, meta?: unknown): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", message, meta));
    }
  },

  warn(message: string, meta?: unknown): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, meta));
    }
  },

  error(message: string, error?: Error | unknown, meta?: unknown): void {
    if (shouldLog("error")) {
      const errorMeta = error instanceof Error
        ? { message: error.message, stack: error.stack, ...(meta as object) }
        : { error, ...(meta as object) };
      console.error(formatMessage("error", message, errorMeta));
    }
  },

  event(eventType: string, data: unknown): void {
    if (shouldLog("info")) {
      console.log(formatMessage("info", `EVENT: ${eventType}`, data));
    }
  },
};
