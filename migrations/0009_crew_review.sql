-- The review flag (the captain's (b), 2026-11-25; ADR 0027): whether a task's pull request or branch changes `.claude/`
-- or `.mcp.json`. Additive only, the captain's standing rule: three new columns on crew_tasks, nothing rebuilt,
-- renamed or rewritten.
--
-- pr_touches is set with the PR's other facts from `gh pr view` (paths only); branch_touches from `git log --name-only`
-- over the branch's own commits. Each is JSON {"paths": [...], "unknown": bool}, NULL until read. branch_checked_at is
-- when the branch was last read, so it is read at most once a minute.

ALTER TABLE crew_tasks ADD COLUMN pr_touches TEXT;
ALTER TABLE crew_tasks ADD COLUMN branch_touches TEXT;
ALTER TABLE crew_tasks ADD COLUMN branch_checked_at INTEGER;
