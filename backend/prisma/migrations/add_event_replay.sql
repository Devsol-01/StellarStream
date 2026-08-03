-- Migration: Smart Contract Event Replay Feature (#1375)
-- Adds named checkpoints into a stream's event log and an audit trail of
-- replay/state-reconstruction runs.

CREATE TABLE IF NOT EXISTS "ReplayCheckpoint" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "streamId"  TEXT NOT NULL,
  "eventId"   TEXT NOT NULL,
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReplayCheckpoint_streamId_eventId_key"
  ON "ReplayCheckpoint"("streamId", "eventId");

CREATE INDEX IF NOT EXISTS "ReplayCheckpoint_streamId_idx"
  ON "ReplayCheckpoint"("streamId");

CREATE TABLE IF NOT EXISTS "ReplayRun" (
  "id"                     TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "streamId"               TEXT NOT NULL,
  "fromEventId"            TEXT,
  "toEventId"              TEXT,
  "eventCount"             INTEGER NOT NULL,
  "reconstructedStatus"    TEXT,
  "reconstructedWithdrawn" TEXT,
  "matchesLive"            BOOLEAN,
  "differences"            JSONB,
  "durationMs"             INTEGER NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ReplayRun_streamId_idx"
  ON "ReplayRun"("streamId");

CREATE INDEX IF NOT EXISTS "ReplayRun_createdAt_idx"
  ON "ReplayRun"("createdAt");
