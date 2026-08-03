-- Migration: Payment Routing Rules Feature (#1361)
-- Adds a rule engine that routes payments to a destination based on
-- amount, asset, geography, or time-of-day conditions.

-- Routing rules
CREATE TABLE IF NOT EXISTS "PaymentRoutingRule" (
  "id"           TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ownerAddress" TEXT NOT NULL,                  -- Stellar address of the creator
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "route"        TEXT NOT NULL,                  -- destination route/gateway identifier
  "priority"     INTEGER NOT NULL DEFAULT 0,      -- higher priority evaluated first
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRoutingRule_ownerAddress_name_key"
  ON "PaymentRoutingRule"("ownerAddress", "name");

CREATE INDEX IF NOT EXISTS "PaymentRoutingRule_ownerAddress_idx"
  ON "PaymentRoutingRule"("ownerAddress");

CREATE INDEX IF NOT EXISTS "PaymentRoutingRule_ownerAddress_isActive_priority_idx"
  ON "PaymentRoutingRule"("ownerAddress", "isActive", "priority");

-- Conditions attached to a routing rule (AND semantics within a rule)
CREATE TABLE IF NOT EXISTS "PaymentRoutingCondition" (
  "id"       TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ruleId"   TEXT NOT NULL REFERENCES "PaymentRoutingRule"("id") ON DELETE CASCADE,
  "type"     TEXT NOT NULL,   -- 'amount' | 'asset' | 'geography' | 'time'
  "operator" TEXT NOT NULL,   -- 'gte' | 'lte' | 'between' | 'equals' | 'in'
  "value"    TEXT NOT NULL,
  "value2"   TEXT             -- upper bound for 'between'
);

CREATE INDEX IF NOT EXISTS "PaymentRoutingCondition_ruleId_idx"
  ON "PaymentRoutingCondition"("ruleId");
