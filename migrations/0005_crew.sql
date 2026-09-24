-- Build 3: Kinas's read-only mirror of Firstmate's fleet (ADR 0016). Kinas owns none of it: every row is rebuilt from
-- fm-fleet-snapshot.v1, Herdr and gh. Deliberately omitted: briefs, status logs, pane text, quota. crew_workers is a
-- cache; nothing else is ever deleted.

CREATE TABLE crew_tasks (
  org_id TEXT NOT NULL REFERENCES orgs(id), id TEXT NOT NULL,
  title TEXT, excerpt TEXT, repo TEXT, project TEXT, project_name TEXT,
  kind TEXT NOT NULL, backlog_state TEXT, state TEXT, state_source TEXT, state_detail TEXT, state_observed_at TEXT,
  mode TEXT, yolo INTEGER NOT NULL DEFAULT 0, harness TEXT, backend TEXT,
  endpoint_target TEXT, endpoint_exists INTEGER, endpoint_status TEXT,
  worktree_path TEXT, worktree_present INTEGER, report_path TEXT, report_present INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT, pr_number INTEGER, pr_state TEXT, pr_draft INTEGER, pr_mergeable TEXT, pr_review TEXT,
  pr_checks_total INTEGER, pr_checks_failed INTEGER, pr_checked_at INTEGER,
  pending_decision INTEGER NOT NULL DEFAULT 0, blocked_event INTEGER NOT NULL DEFAULT 0,
  captain_actionable INTEGER NOT NULL DEFAULT 0, hold_reason TEXT,
  snapshot_generated TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL, first_working_at INTEGER, last_seen_at INTEGER NOT NULL,
  done_at INTEGER, gone_at INTEGER,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE crew_workers (
  org_id TEXT NOT NULL REFERENCES orgs(id), task_id TEXT NOT NULL,
  session TEXT NOT NULL, pane_id TEXT NOT NULL, workspace_id TEXT, tab_label TEXT,
  alive INTEGER NOT NULL, foreground TEXT, observed_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, task_id)
);

CREATE TABLE crew_events (
  org_id TEXT NOT NULL REFERENCES orgs(id), id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL, at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('state','word','last_event','pr','checks','order','gone','returned')),
  text TEXT NOT NULL, dedupe_key TEXT
);
CREATE UNIQUE INDEX crew_events_dedupe ON crew_events (org_id, task_id, kind, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX crew_events_task ON crew_events (org_id, task_id, at);
CREATE INDEX crew_events_at ON crew_events (org_id, at);

CREATE TABLE crew_decisions (
  org_id TEXT NOT NULL REFERENCES orgs(id), task_id TEXT NOT NULL, key TEXT NOT NULL,
  verb TEXT NOT NULL CHECK (verb IN ('needs-decision','blocked','captain-hold')),
  summary TEXT NOT NULL,
  opened_at INTEGER NOT NULL, closed_at INTEGER,
  copied_at INTEGER,                    -- Kinas's stamp: an answer line was put on the clipboard; never the answer
  PRIMARY KEY (org_id, task_id, key)
);

-- `reader_status.reader` must admit the id 'crew'. SQLite cannot ALTER a CHECK, so the table is rebuilt — create,
-- INSERT ... SELECT, drop, rename — exactly as 0004 did, with 0004's column order, types, nullability, both CHECKs and
-- the primary key copied verbatim; the reader id list is the only difference. 0004's pre-flight holds here too:
--
-- Checked before writing this, against the real store rather than assumed (task 2.1):
--   SELECT type, name FROM sqlite_master WHERE tbl_name = 'reader_status';
--   -> table|reader_status
--      index|sqlite_autoindex_reader_status_1
-- The only attachment is the implicit index SQLite creates for the PRIMARY KEY, which the new table creates for
-- itself. No user index, trigger or view exists, so DROP TABLE takes nothing with it.
-- Checked again for this migration on 2026-09-24, read-only against the captain's store at version 4: the same two rows.

CREATE TABLE reader_status_new (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  reader TEXT NOT NULL CHECK (reader IN ('claude-plan', 'ollama-cloud', 'claude-code-logs', 'pi-logs', 'host', 'convex', 'hostinger', 'crew')),
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
