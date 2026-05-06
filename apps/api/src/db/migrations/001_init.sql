-- WebToApp SaaS — initial database schema
-- Run with: psql $DATABASE_URL < migrations/001_init.sql

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE conversion_status AS ENUM (
  'queued',
  'detecting',
  'planning',
  'transforming',
  'scaffolding',
  'installing',
  'building',
  'packaging',
  'done',
  'failed',
  'cancelled'
);

CREATE TYPE plan AS ENUM ('free', 'pro', 'team', 'enterprise');

-- ── Users ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT,
  password_hash         TEXT,
  plan                  plan NOT NULL DEFAULT 'free',
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  monthly_usage         INTEGER NOT NULL DEFAULT 0,
  usage_reset_at        TIMESTAMPTZ DEFAULT NOW(),
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_stripe_customer ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── API Keys ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Default',
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user ON api_keys (user_id);
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);

-- ── Conversions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversions (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  source_type       TEXT NOT NULL DEFAULT 'github',
  source_url        TEXT,
  job_id            TEXT,
  status            conversion_status NOT NULL DEFAULT 'queued',
  detection_result  JSONB,
  plan_summary      TEXT,
  targets           TEXT[] NOT NULL DEFAULT '{}',
  installer_url     TEXT,
  installer_size    INTEGER,
  error_message     TEXT,
  duration_ms       INTEGER,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversions_user    ON conversions (user_id);
CREATE INDEX idx_conversions_status  ON conversions (status);
CREATE INDEX idx_conversions_job     ON conversions (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_conversions_created ON conversions (created_at DESC);

-- ── Downloads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS downloads (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  conversion_id   TEXT NOT NULL REFERENCES conversions (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  download_url    TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  downloaded_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_downloads_conversion ON downloads (conversion_id);
CREATE INDEX idx_downloads_user       ON downloads (user_id);

-- ── Auto-update updated_at ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversions_updated_at
  BEFORE UPDATE ON conversions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
