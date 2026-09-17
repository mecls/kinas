-- Convex usage, and the two schema changes it forces (prd-convex-usage.md R9, R10).
--
-- `quotas` cannot hold this. It is keyed (org_id, subscription, "window") with one `used_pct` per row, its CHECK
-- pins `used_pct` to 0-100 and `"window"` to session|week|month_credits. Nine metrics across two windows do not
-- fit that shape, and minting nine fake `subscription` strings to force them in would abuse the very constraint
-- that makes `quotas` meaningful. So: a table shaped for a provider's metrics.

CREATE TABLE provider_metrics (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  "window" TEXT NOT NULL,
  used REAL NOT NULL,
  -- Nullable, and that is how a figure without a plan allowance is stored: `aiGatewayCostDollars` has no
  -- denominator, so it keeps a NULL limit and a NULL `used_pct` and renders as a number, never a gauge (R8).
  limit_value REAL,
  unit TEXT,
  used_pct REAL,
  detail TEXT,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, provider, metric, "window")
);

-- Three deliberate omissions, each with a reason, so nobody "tightens" them later without knowing the cost:
--
-- 1. No CHECK on `provider`, `metric` or `"window"`. Hostinger and Vercel are the next two integrations, and a
--    `CHECK (provider IN ('convex'))` would force a full table rebuild for each of them — exactly the awkwardness
--    R10 documents below — for no safety gain: these strings come from Rust constants, never from user input, and
--    the reader's unit tests pin every one of them.
-- 2. No 0-100 CHECK on `used_pct`, unlike `quotas`. Usage over 100 % is real and billed; R6 keeps it rather than
--    clamping it, because hiding overage is the one thing a usage gauge exists to prevent. A CHECK here would turn
--    a real overage into a write failure and lose the reading entirely.
-- 3. No index. `provider_metrics` is read by one query per snapshot, keyed on its primary key's leading columns,
--    and holds tens of rows. An index would be a second thing to carry through every future rebuild.

-- R10: SQLite cannot ALTER a CHECK, so admitting the reader id 'convex' means rebuilding the table —
-- create, INSERT ... SELECT, drop, rename. Column order, types, nullability, the CHECKs and the primary key are
-- copied verbatim from 0001_init.sql; the reader id list is the only change. Verified that no index, trigger or
-- view is attached to `reader_status`, because DROP TABLE would take those with it.
CREATE TABLE reader_status_new (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  reader TEXT NOT NULL CHECK (reader IN ('claude-plan', 'ollama-cloud', 'claude-code-logs', 'pi-logs', 'host', 'convex')),
  state TEXT NOT NULL CHECK (state IN ('ok', 'error', 'not_configured')),
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  stale_after_ms INTEGER NOT NULL,
  dead_after_ms INTEGER NOT NULL,
  PRIMARY KEY (org_id, reader)
);

INSERT INTO reader_status_new (org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms)
SELECT org_id, reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms
FROM reader_status;

DROP TABLE reader_status;

ALTER TABLE reader_status_new RENAME TO reader_status;
