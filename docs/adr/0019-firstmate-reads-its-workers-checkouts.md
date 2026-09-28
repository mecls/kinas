# 0019 · The first mate is Firstmate, adopted; Kinas runs only its read-only scripts and reads under its home, and in its workers' checkouts, only what is listed here

Date: 2026-09-28
Status: accepted

## Context

ADR 0018 listed every read Kinas makes under Firstmate's home, and said a read it does not name is a new record that
supersedes it. Crew marks (`tasks/crew-marks/prd.md`, 2026-09-28) mark on the captain's own file trees what the crew
has changed and not pushed. That means reading the crew's checkouts: a project clone under `projects/`, and the
worktrees git keeps for it. `treehouse` puts those under `~/.treehouse`, outside the home (checked 2026-09-28: a live
worker's checkout there is a worktree of the clone, and the clone's `git worktree list` names it with its branch).

## Decision

The first mate is Firstmate, running on Claude Code, on the Herdr backend, adopted at a pinned commit (reviewed monthly) into Kinas's own clone under the data directory, which is also its home. Kinas builds only the bridge: the installer, one launcher, a read-only mirror of the fleet fed by Firstmate's fleet snapshot (`bin/fm-fleet-snapshot.sh --json`), the Crew page, the Inbox, the order log in Kinas's own store, and crew marks on the captain's file trees. Kinas runs only Firstmate's read-only scripts — `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field <name>` and `fm-project-mode.sh <name>` — and no script that changes anything, `fm-send.sh` included: the captain's answers reach the first mate in its own chat (ADR 0017). Besides those scripts' output, Kinas reads under the home only:

- the modification times of `data/backlog.md` and `state/home-summary.json`, as triggers;
- a report or a brief the captain opens, whether a task's brief and report exist, and a report's first line for the context packet;
- the `origin` in a project clone's `.git/config` (a `.git` file's `gitdir:` followed), to match the project to a client folder or to a file tree's repository;
- `config/backend`, read back;
- the names of the folders under `projects/`, to ask `fm-project-mode.sh` about each and to pair a project with a file tree — never `data/projects.md`;
- whether `state/.afk-contract` exists, before asking `fm-afk-contract.sh` — never the file itself;
- whether `bin/fm-fleet-snapshot.sh` and `.git` exist, and `git rev-parse HEAD` and `git symbolic-ref --short -q HEAD` in the home, to tell whether the clone is installed and at its pin.

For crew marks, and only for a project clone whose GitHub `origin` is also a watched file tree's, Kinas also reads, in the clone and in each worktree git lists for it wherever that worktree lies (`~/.treehouse` included):

- the list of those worktrees (`git worktree list --porcelain`), each one's branch, and the commit its branch last pushed (`@{upstream}`, else `origin/<branch>`, else its merge-base with `origin/HEAD`);
- the names of the files it changed since that commit and does not ignore (`diff-index`, `ls-files --others --exclude-standard`), and their hashes (`ls-tree`, `hash-object` without `-w`);
- the text of one such file, then and now (`cat-file --filters`, and a file read), only when the captain opens it;
- FSEvents on those checkouts, on the clone's git folder and on the names under `projects/`.

All of it is git plumbing with optional locks off, or a file read. Kinas's own code writes nothing under the home — not `data/`, not `state/`, not `config/`, not `projects/` — except `config/backend`, written once by `kinas crew setup` before any first mate exists; and nothing in a worker's checkout. There, Kinas never fetches, checks out, stashes, resets or runs `git status`. Kinas never runs `quota-axi` and never touches the wake.

## Consequences

The captain sees on their own tree what the crew is changing and has not pushed, and a click on it shows the crew's own text, read-only; nothing of it is stored or logged beyond counts. A worker's checkout that git does not list for the clone is invisible to Kinas, and a push made from a checkout elsewhere is seen only when that clone's refs move. Everything the 0018 list allowed stays allowed, and nothing more: a read under the home or in a worker's checkout that this list does not name is a new record that supersedes this one. Enforced by `app/src-tauri/src/readers/crew/guard.rs` — its WRITES rule covers `crew/`, `readers/crew/` and `reader/changes/crew.rs`, the other rules as 0018 set them, and its negative control proves they can fail — by `reader/changes/git.rs`'s test that a crew clone's and its worktree's objects, `index`, `config`, `FETCH_HEAD` and `packed-refs` are unchanged across every read, by `app/src-tauri/src/crew/firstmate.rs` being the only file that builds a path under `<home>/bin/`, by `packages/context/src/sources/firstmate.ts`'s schema check, and by `docs/external/firstmate-home.md`.
