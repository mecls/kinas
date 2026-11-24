-- The factory in the cloud (tasks/cloud-factory/prd.md; ADRs 0022–0024). Additive only, the captain's standing rule:
-- four new tables and two indexes, nothing rebuilt, renamed or rewritten. reader_status is left as it is: while the
-- place is a VPS, the crew reader's own row carries why the VPS could not be read, and vps_reachability below keeps the
-- rest (build spec §17, 2026-11-18).

-- The VPS as the Mac last reached it through the door (ADR 0024): one row per org, replaced on each attempt.
-- reason is a code from remote.rs (`timeout`, `host-key`, …), never ssh's own words.
CREATE TABLE vps_reachability (
  org_id TEXT NOT NULL PRIMARY KEY REFERENCES orgs(id),
  label TEXT NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  reason TEXT,
  companion_version TEXT,
  companion_heartbeat_at INTEGER
);

-- An answer Kinas delivered to the first mate as a note in Firstmate's inbox (ADR 0022). The words are not kept here:
-- they are in the inbox on the VPS. reply is the first mate's, at most 2,000 characters, when it gave one.
CREATE TABLE crew_answers (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  request_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approve','deny','answer')),
  origin TEXT NOT NULL CHECK (origin IN ('mac','phone')),
  outcome TEXT NOT NULL CHECK (outcome IN ('delivered','already','not_open','unreachable','expired')),
  delivered_at INTEGER,
  read_at INTEGER,
  reply TEXT,
  PRIMARY KEY (org_id, request_id)
);
CREATE INDEX crew_answers_item ON crew_answers (org_id, item_key);

-- What the companion recorded for the factory's numbers (PRD rules 18–21). Never deleted.
CREATE TABLE factory_events (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  task_id TEXT NOT NULL,
  project TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('dispatched','pr_ready','merged','cleaned_up','held','answered','hold_closed','red','tokens')),
  at INTEGER NOT NULL,
  value INTEGER,
  PRIMARY KEY (org_id, task_id, event, at)
);
CREATE INDEX factory_events_at ON factory_events (org_id, at);

-- When the Mac's window had focus, for "While you were away" (PRD rule 19).
CREATE TABLE focus_spans (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  PRIMARY KEY (org_id, start)
);
