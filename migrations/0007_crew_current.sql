-- Firstmate, current (tasks/crew-firstmate-current/prd.md, ADR 0020): what Firstmate 427056c publishes, mirrored.
-- Additive only, the captain's standing rule: new columns on crew_tasks and one new table, nothing rebuilt or
-- rewritten. crew_events' kind CHECK is therefore left as it is; the ledger's events live in their own table and join
-- the timeline when it is read.
--
-- branch and held_pr_url are the snapshot's, set every cycle (NULL when absent). dispatched_at, merged_at and
-- merged_via are stamped from the fleet ledger, the first stamp kept, as done_at is.

ALTER TABLE crew_tasks ADD COLUMN branch TEXT;
ALTER TABLE crew_tasks ADD COLUMN held_pr_url TEXT;
ALTER TABLE crew_tasks ADD COLUMN dispatched_at INTEGER;
ALTER TABLE crew_tasks ADD COLUMN merged_at INTEGER;
ALTER TABLE crew_tasks ADD COLUMN merged_via TEXT CHECK (merged_via IN ('pr','local'));

-- The fleet ledger's four kept events (task.dispatched, task.pr_ready, task.merged, task.cleaned_up). Append-only:
-- an emptied ledger file takes nothing from here. SQLite treats NULLs as distinct in a UNIQUE index, so an event with
-- no PR stores pr_url as '' and a duplicate record is ignored by INSERT OR IGNORE.
CREATE TABLE crew_ledger (
  org_id TEXT NOT NULL REFERENCES orgs(id), task_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('dispatched','pr_ready','merged','cleaned_up')),
  at INTEGER NOT NULL, pr_url TEXT, via TEXT, harness TEXT,
  UNIQUE (org_id, task_id, event, at, pr_url)
);
CREATE INDEX crew_ledger_task ON crew_ledger (org_id, task_id, at);
