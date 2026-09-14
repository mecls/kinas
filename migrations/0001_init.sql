-- Kinas Build 1 schema. PRD rules R8 (tables), R9 (org_id NOT NULL), R12 (staleness limits).
-- Forward-only (R10): never edit this file after it has shipped; add 0002_… instead.
-- Timestamps are INTEGER milliseconds since the Unix epoch, UTC.
-- `schema_migrations` is created by the store bootstrap, not here.
-- "window" and "offset" are SQL keywords, so they are always quoted.

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (org_id, key)
);

CREATE TABLE hosts (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  machine TEXT NOT NULL,
  cpu_pct REAL,
  mem_used_gb REAL NOT NULL,
  mem_total_gb REAL NOT NULL,
  disk_used_gb REAL NOT NULL,
  disk_total_gb REAL NOT NULL,
  services TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, machine)
);

CREATE TABLE quotas (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  subscription TEXT NOT NULL CHECK (subscription IN ('claude-plan', 'ollama-cloud')),
  "window" TEXT NOT NULL CHECK ("window" IN ('session', 'week', 'month_credits')),
  used_pct REAL NOT NULL CHECK (used_pct >= 0 AND used_pct <= 100),
  resets_at INTEGER,
  plan TEXT,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, subscription, "window")
);

CREATE TABLE reader_status (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  reader TEXT NOT NULL CHECK (reader IN ('claude-plan', 'ollama-cloud', 'claude-code-logs', 'pi-logs', 'host')),
  state TEXT NOT NULL CHECK (state IN ('ok', 'error', 'not_configured')),
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  stale_after_ms INTEGER NOT NULL,
  dead_after_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, reader)
);

CREATE TABLE usage_daily (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  harness TEXT NOT NULL CHECK (harness IN ('claude-code', 'pi')),
  source TEXT NOT NULL DEFAULT 'interactive' CHECK (source IN ('interactive')),
  machine TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  PRIMARY KEY (org_id, date, provider, model, harness, machine)
);

-- What has already been counted for each message, so a later line for the same message adds only
-- its positive delta (R21). provider/model/machine locate the usage_daily row the delta goes to.
CREATE TABLE usage_seen (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  harness TEXT NOT NULL CHECK (harness IN ('claude-code', 'pi')),
  message_key TEXT NOT NULL,
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  machine TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_cache_read INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  PRIMARY KEY (org_id, harness, message_key)
);

CREATE INDEX usage_seen_by_date ON usage_seen (org_id, date);

CREATE TABLE log_cursors (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  path TEXT NOT NULL,
  inode INTEGER NOT NULL,
  "offset" INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, path)
);
