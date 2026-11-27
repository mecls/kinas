# 0030 · A respawned worker keeps its own temp and token folders; anything else at their names refuses the launch

Date: 2026-11-26
Status: superseded by 0031

## Context

ADR 0029 gives each worker its own temp folder, `/tmp/kw/<first 8 hex of sha256(task id)>`. It says: "Any folder
already at that name refuses the launch."

While slice 5b was being built (2026-11-26), Firstmate turned out to respawn a worker under its old task id
(`fm-bootstrap.sh`, `respawned.<id>`). The respawned worker's temp folder, and its token folder
`~/.local/state/kinas/workers/<id>/`, are still there from its first start. As written, 0029 would refuse every
respawn. The build kept the worker's own folder instead and raised it with the captain. The captain approved that the
same day: "reuse only a real folder, same user, mode 700; refuse anything else".

## Decision

ADR 0029's decision stands, except its sentence "Any folder already at that name refuses the launch", which this
record replaces.

At a worker's launch, `/tmp/kw`, the worker's temp folder and its token folder are each kept as they are when they are
all three of:
- a real folder, never a link;
- owned by the user the companion runs as;
- mode 700 exactly.

Anything else at one of those names refuses the launch: a file, a link, another user's folder, or a folder with any
other mode. Kinas never changes, empties or replaces it. A name that is free is made as a folder, mode 700.

## Consequences

- **A respawned worker starts again** with its own temp files and the token folder its new token is written into.
  The token it held before is revoked once the new one is written.
- **A folder planted at a worker's name by anyone else refuses that worker.** That includes a link, or a folder left
  readable by others. The launch says which path and why.
- **What a respawn finds is its own earlier worker's.** It is the same task's folder, and only the same user could
  have written it.
- **A correction to ADR 0029's enforcement list,** which can't be edited. The Linux machine's branch reading and its
  base are in `cli/src/companion/run.ts` (`branchArgs`, `branchesNow`), not `touches.rs`. The Mac's `touches.rs` is
  unchanged.

Enforced by `cli/src/companion/worker.ts` (`ownFolder`, used by `workerLaunch` and `tokens.ts` `writeTokenFiles`) and
its tests in `worker.test.ts` and `tokens.test.ts`.

Supersedes 0029.
