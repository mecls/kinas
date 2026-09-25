# 0018 · The first mate is Firstmate, adopted; Kinas runs only its read-only scripts and reads under its home only what is listed here

Date: 2026-09-25
Status: accepted

## Context

ADR 0016 adopted Firstmate as the first mate, let Kinas run only its three read-only scripts, and listed what else Kinas reads under Firstmate's home. Building the crew (`tasks/first-mate/build-spec.md` §17, slices 2 and 4) needed reads that list does not name. Settings → Crew reads back `config/backend`, the one file Kinas writes there. It lists the folder names under `projects/` to ask `fm-project-mode.sh` about each, instead of reading `data/projects.md`, whose contents ADR 0016 keeps Kinas out of. It checks that `state/.afk-contract` exists before asking `fm-afk-contract.sh` about it. It asks git where the clone's `HEAD` is, to say whether it is at the pin. The task detail checks that a task's brief exists before offering to open it. Each is a name, an existence or a commit, never a file's contents. The captain asked for a record that says so (2026-09-25).

## Decision

The first mate is Firstmate, running on Claude Code, on the Herdr backend, adopted at a pinned commit (reviewed monthly) into Kinas's own clone under the data directory, which is also its home. Kinas builds only the bridge: the installer, one launcher, a read-only mirror of the fleet fed by Firstmate's fleet snapshot (`bin/fm-fleet-snapshot.sh --json`), the Crew page, the Inbox, and the order log in Kinas's own store. Kinas runs only Firstmate's read-only scripts — `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field <name>` and `fm-project-mode.sh <name>` — and no script that changes anything, `fm-send.sh` included: the captain's answers reach the first mate in its own chat (ADR 0017). Besides those scripts' output, Kinas reads under the home only:

- the modification times of `data/backlog.md` and `state/home-summary.json`, as triggers;
- a report or a brief the captain opens, whether a task's brief and report exist, and a report's first line for the context packet;
- the `origin` in a project clone's `.git/config` (a `.git` file's `gitdir:` followed), to match the project to a client folder;
- `config/backend`, read back;
- the names of the folders under `projects/`, to ask `fm-project-mode.sh` about each — never `data/projects.md`;
- whether `state/.afk-contract` exists, before asking `fm-afk-contract.sh` — never the file itself;
- whether `bin/fm-fleet-snapshot.sh` and `.git` exist, and `git rev-parse HEAD` and `git symbolic-ref --short -q HEAD` in the home, to tell whether the clone is installed and at its pin.

Kinas's own code writes nothing under the home — not `data/`, not `state/`, not `config/`, not `projects/` — except `config/backend`, written once by `kinas crew setup` before any first mate exists. Kinas never runs `quota-axi` and never touches the wake.

## Consequences

Everything Firstmate already does — the queue, briefs, spawning, supervision, decisions, merges, teardown, away mode — is Firstmate's, and Kinas shows it; a feature Firstmate lacks is not built into Kinas. An answer from the Inbox costs the captain a paste and Enter in the first mate's pane, and it arrives as their own words in the chat Firstmate trusts. Kinas cannot see an answer arrive, so an item leaves only when Firstmate's snapshot stops listing it. A contract that moves at the pin is refused and the last reading stays (ADR 0004). A read under the home that this list does not name is a new record that supersedes this one. Enforced by `app/src-tauri/src/readers/crew/guard.rs` — its tests fail when the crew's code could write a file, type into a pane or name a Firstmate script beyond the three, `fm-send.sh` above all, and its negative control proves they can — by `app/src-tauri/src/crew/firstmate.rs` being the only file that builds a path under `<home>/bin/`, by `packages/context/src/sources/firstmate.ts`'s schema check, and by `docs/external/firstmate-home.md`.
