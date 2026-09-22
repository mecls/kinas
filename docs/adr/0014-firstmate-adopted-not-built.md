# 0014 · The first mate is Firstmate on Claude Code, adopted, not built; Kinas writes nothing under its home

Date: 2026-09-22
Status: accepted

## Context

Kinas needs a conductor: one agent the captain talks to that files tasks, launches disposable workers in isolated worktrees, supervises them, answers their questions and tears them down. The first draft of Build 3 (2026-09-22) rebuilt that natively, and its hardest part — waking the conductor when the fleet needs it, without spending tokens on a watcher — was the part nobody had asked about. Firstmate (`github.com/kunchenguid/firstmate`) already does all of it on Claude Code, with a verified turn-end guard: a tracked Stop hook re-arms its watcher and rewakes the session. Its architecture also forbids what the first draft assumed: its status files are append-only, provenance-guarded event logs, and a foreign write fails toward a wake. Settled with the captain on 2026-09-22 (`tasks/first-mate/build-spec.md` §16).

## Decision

The first mate is Firstmate, running on Claude Code, on the Herdr backend, adopted at a pinned commit (reviewed monthly) into Kinas's own clone under the data directory, which is also its home. Kinas builds only the bridge: the installer, one launcher, a read-only mirror of the fleet fed by Firstmate's two JSON contracts (`bin/fm-fleet-snapshot.sh --json`, `state/home-summary.json`) and never by parsing its files, the Crew page, the inbox, and the order log in Kinas's own store. Kinas's own code writes nothing under Firstmate's home — not `data/`, not `state/`, not `config/`, not `projects/`. The one mutating operation is Firstmate's own `fm-send.sh`, run as a process with a fixed argv on a click in the inbox. Kinas never runs `quota-axi` (it reads Claude Code's credential and calls Anthropic) and never touches the wake.

## Consequences

Everything Firstmate already does — the queue, briefs, spawning, supervision, decisions, merges, teardown, away mode — is Firstmate's, and Kinas shows it; a feature Firstmate lacks is not built into Kinas. A contract that moves at the pin is refused, and the last reading stays (ADR 0004). Enforced by `packages/context/src/sources/firstmate.ts:1-4`, `:34` (the schema check), `cli/src/main.ts:3` ("Firstmate, Herdr and git are read, never written"), `docs/external/firstmate-home.md`, and — once Build 3 lands — the collector's guard tests with their negative controls (no writes under the home; `fm-send.sh` the only script run) named in `tasks/first-mate/build-spec.md` §6 and §12.
