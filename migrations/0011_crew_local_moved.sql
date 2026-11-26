-- The local-only landing's check (ADR 0029, build spec §12 5b.D): a local-only task whose clone's local default branch
-- on the Linux machine is not the commit it was at the task's launch, from the reading in which its worker reported done
-- until it landed. Additive only, the captain's standing rule: one new column on crew_tasks, nothing rebuilt, renamed or
-- rewritten.
--
-- local_moved is JSON {"branch": "...", "was": "<40 hex>", "now": "<40 hex>" | null}; NULL while nothing moved.

ALTER TABLE crew_tasks ADD COLUMN local_moved TEXT;
