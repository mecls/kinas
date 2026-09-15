-- The CLI's own cache (CLI v0 brief): the computed context packet and the activity log, in kinas-cli.sqlite beside
-- the app's store. Not in the store itself: that file has exactly one writer, the app (PRD rule 7), and the CLI
-- opens it read-only. hosts, quotas and usage_daily stay the app's tables; the CLI reads them there and does not
-- copy them.
--
-- Forward-only: never edit this file after it has shipped; add 0002_… instead.
-- Timestamps are INTEGER milliseconds since the Unix epoch, UTC. Every row carries org_id: the single org in v0.
-- `schema_migrations` is created by the cache bootstrap, not here.

CREATE TABLE packet_cache (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, key)
);

-- One row per notable event. `ref` names the event uniquely (commit:<path>:<sha>, brief:<id>, …), so seeing the
-- same commit on every refresh records it once.
CREATE TABLE activity_log (
  org_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'crew', 'brief', 'file')),
  project TEXT,
  text TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, ref)
);

CREATE INDEX activity_log_by_time ON activity_log (org_id, at);
