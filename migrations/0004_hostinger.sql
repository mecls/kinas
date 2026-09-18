-- Hostinger VPS usage (prd-hostinger-usage.md R15).
--
-- One change only: `reader_status.reader` must admit the id 'hostinger'. SQLite cannot ALTER a CHECK, so the
-- table is rebuilt — create, INSERT ... SELECT, drop, rename. Column order, types, nullability, both CHECKs and
-- the primary key are copied verbatim from 0003's rebuild; the reader id list is the only difference.
--
-- `provider_metrics` is deliberately **not** touched. 0003 omitted any CHECK on `provider`, `metric` and
-- `"window"` precisely so that each new provider would not force a second rebuild, and Hostinger is the first
-- integration to collect on that: its rows need no schema change at all.
--
-- Checked before writing this, against the real store rather than assumed (task 2.1):
--   SELECT type, name FROM sqlite_master WHERE tbl_name = 'reader_status';
--   -> table|reader_status
--      index|sqlite_autoindex_reader_status_1
-- The only attachment is the implicit index SQLite creates for the PRIMARY KEY, which the new table creates for
-- itself. No user index, trigger or view exists, so DROP TABLE takes nothing with it.

CREATE TABLE reader_status_new (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  reader TEXT NOT NULL CHECK (reader IN ('claude-plan', 'ollama-cloud', 'claude-code-logs', 'pi-logs', 'host', 'convex', 'hostinger')),
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
