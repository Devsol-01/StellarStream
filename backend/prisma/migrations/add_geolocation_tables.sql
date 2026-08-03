-- Migration: add_geolocation_tables
-- Adds geolocation support for compliance and analytics

-- ── Geographic Restrictions ───────────────────────────────────────────────────
-- Stores per-address geographic allow/block rules for compliance
CREATE TABLE IF NOT EXISTS "GeoRestriction" (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address VARCHAR(58) NOT NULL,
  region       VARCHAR(10) NOT NULL,  -- ISO 3166-1 alpha-2 country code or region
  action       VARCHAR(10) NOT NULL,  -- "block" or "allow"
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_restriction_owner_region
  ON "GeoRestriction" (owner_address, region);
CREATE INDEX IF NOT EXISTS idx_geo_restriction_owner ON "GeoRestriction" (owner_address) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_geo_restriction_region ON "GeoRestriction" (region);
CREATE INDEX IF NOT EXISTS idx_geo_restriction_active ON "GeoRestriction" (is_active);

-- ── Geographic Analytics Events ───────────────────────────────────────────────
-- Privacy-compliant: stores SHA-256 hash of IP, never raw IP
-- Retained for 30 days for privacy compliance
CREATE TABLE IF NOT EXISTS "GeoAnalyticsEvent" (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash      VARCHAR(64) NOT NULL,    -- SHA-256 hash of IP
  country_code CHAR(2)     NOT NULL,    -- ISO 3166-1 alpha-2
  region       VARCHAR(32),             -- Region if available
  city         VARCHAR(64),             -- City name
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  user_agent   TEXT,
  path         VARCHAR(256) NOT NULL,  -- API endpoint
  method       VARCHAR(10) NOT NULL,   -- GET, POST, etc
  user_id      VARCHAR(58),             -- Stellar address if authenticated
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geo_analytics_ip ON "GeoAnalyticsEvent" (ip_hash);
CREATE INDEX IF NOT EXISTS idx_geo_analytics_country ON "GeoAnalyticsEvent" (country_code);
CREATE INDEX IF NOT EXISTS idx_geo_analytics_created ON "GeoAnalyticsEvent" (created_at);
CREATE INDEX IF NOT EXISTS idx_geo_analytics_user ON "GeoAnalyticsEvent" (user_id);

-- ── Purge old analytics (30-day retention) ───────────────────────────────────
-- This should be run periodically via a cron job or scheduled task
-- CREATE INDEX IF NOT EXISTS idx_geo_analytics_cleanup ON "GeoAnalyticsEvent" (created_at);