-- The worktree scan (ADR 0028, build spec §12 4.14): whether a task's worktree on the VPS holds a `.claude` or
-- `.mcp.json` that isn't the repository's, from the reading in which its worker reported done until it landed.
-- Additive only, the captain's standing rule: two new columns on crew_tasks, nothing rebuilt, renamed or rewritten.
--
-- worktree_touches is JSON {"paths": [...], "unknown": bool}, as pr_touches and branch_touches; NULL until scanned.
-- worktree_checked_at is when the Mac applied the last scan.

ALTER TABLE crew_tasks ADD COLUMN worktree_touches TEXT;
ALTER TABLE crew_tasks ADD COLUMN worktree_checked_at INTEGER;
