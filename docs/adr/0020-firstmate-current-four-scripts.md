# 0020 · The first mate is Firstmate at its current pin; Kinas runs only four of its scripts, accepts the snapshot's own latch, and reads under its home only what is listed here

Date: 2026-11-16
Status: superseded by 0022

## Context

On 2026-11-15 the captain asked to adopt Firstmate as it now is, with Claude Code staying the first mate's harness
(`tasks/crew-firstmate-current/prd.md`). Firstmate's `main` at `427056c` (2026-11-12) keeps the fleet snapshot's
contract (`fm-fleet-snapshot.v1`) and publishes more: a task's branch, the PRs a held task owns, park on review, a
lane-capacity verdict (`bin/fm-capacity.sh --json`, `fm-lane-capacity.v1`) and an opt-in fleet ledger
(`state/fleet-ledger.jsonl`). Its snapshot is no longer strictly read-only: for a task of a `local-only` project whose
finished work it accepts, it records the head that will land (`local_done_head` in `state/<id>.meta`) under
Firstmate's own locks, taken without waiting (`bin/fm-crew-state.sh`, `bin/fm-dod-lib.sh`), and there is no switch to
turn that off. The probe of 2026-11-16 ran Firstmate `427056c` with a real first mate and two `claude` workers in a
throwaway Herdr session and saw that write happen during a snapshot alone.

## Decision

The first mate is Firstmate, running on Claude Code, on the Herdr backend, adopted at the pinned commit `427056c4181c41074ad24f051f79919330df0fa5` (reviewed monthly) into Kinas's own clone under the data directory, which is also its home. Kinas runs four Firstmate scripts and no other: `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field <name>`, `fm-project-mode.sh <name>` and `fm-capacity.sh --json`. The last runs only while `config/lane-capacity` is a regular file whose first line is a lane cap or `auto` and which names no `quota-provider`, at most once every 30 s, under a 10 s limit. The snapshot's `local_done_head` write for a `local-only` task is Firstmate's own write, made under its own locks, and Kinas accepts it as part of the snapshot's contract; it is the only write any script Kinas runs makes under the home. Kinas never runs `fm-send.sh` or any script that spawns, tears down, holds, parks, answers or changes anything else, and the captain's answers reach the first mate in its own chat (ADR 0017).

Besides those scripts' output, Kinas reads under the home everything ADR 0019 lists, and also:

- `state/fleet-ledger.jsonl`, while it exists, opened read-only as a regular file and read from a cursor kept in Kinas's store, at most 4 MiB a cycle; of its records only `task.dispatched`, `task.pr_ready`, `task.merged` and `task.cleaned_up` are kept, a `task.status` record is parsed and dropped, and a record whose `v` is not `1` stops the read;
- whether `config/park-on-review`, `config/fleet-ledger` and `config/lane-capacity` exist, and the lines of `config/lane-capacity` as a regular file under 1 MiB, for the cap and the `quota-provider` key alone.

Kinas's own code writes under the home only `config/backend`, once, from `kinas crew setup` before any first mate exists, and, from the same command after the captain's yes, a fast-forward of the clone's tracked files to the pin by `git merge --ff-only`, refused while the clone has local changes, is on a branch other than `main`, is at or past the pin, has diverged from it, or has a first mate running in Herdr. That move never touches the ignored `data/`, `state/`, `config/` or `projects/`. Kinas never runs `quota-axi`, never reads under `~/.claude`, never writes Firstmate's options, and opens nothing else under the home for writing.

## Consequences

The crew pages can show a task's branch, in review, a held task's PR, free lanes and the ledger's own times without
Kinas typing, answering or configuring anything Firstmate owns. The captain turns park on review, the ledger and the
lane cap on or off by asking the first mate. A `local-only` task's snapshot may now latch the head that lands, which is
what Firstmate's own watcher does too. A read under the home that this list does not name, a fifth script, or a write
beyond the two listed is a new record that supersedes this one. Enforced by `app/src-tauri/src/readers/crew/guard.rs`
(four scripts by name, the WRITES rule over `crew/`, `readers/crew/` and `reader/changes/crew.rs`, and a negative
control that still catches `fm-send.sh` and a planted `fm-park.sh`), by `app/src-tauri/src/crew/firstmate.rs` being
the only file that builds a path under `<home>/bin/`, by `crew/config.rs`'s quota gate and the stub-home test that
the capacity script never runs with a `quota-provider`, by `cli/src/crew-setup.test.ts`'s refusal cases, and by
`docs/external/firstmate-home.md`.
