# 0016 · The first mate is Firstmate, adopted, not built; Kinas runs none of its scripts that change anything

Date: 2026-09-23
Status: accepted

## Context

ADR 0014 adopted Firstmate as the first mate and let Kinas run one mutating script, `fm-send.sh --resolve-key`, so the Inbox could answer a decision on a click. The first mate's slice 0 probe (2026-09-23, `tasks/first-mate/build-spec.md` §17) sent an approval of a held landing exactly that way: the script exited 0 and closed the hold, but nothing landed, and the first mate refused the approval because it had not come from the captain in its chat, then asked again there and landed only after his answer. `fm-send.sh` is the first mate's channel to its workers, not the captain's channel to the first mate. Settled with the captain on 2026-09-23 (`tasks/first-mate/prd.md` §7, answer 1A).

## Decision

The first mate is Firstmate, running on Claude Code, on the Herdr backend, adopted at a pinned commit (reviewed monthly) into Kinas's own clone under the data directory, which is also its home. Kinas builds only the bridge: the installer, one launcher, a read-only mirror of the fleet fed by Firstmate's fleet snapshot (`bin/fm-fleet-snapshot.sh --json`), the Crew page, the Inbox, and the order log in Kinas's own store. Kinas runs only Firstmate's read-only scripts — `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field <name>` and `fm-project-mode.sh <name>` — and no script that changes anything, `fm-send.sh` included: the captain's answers reach the first mate in its own chat (ADR 0017). Besides those scripts' output, Kinas reads under the home only the modification times of `data/backlog.md` and `state/home-summary.json` (as triggers), a report or a brief the captain opens, a report's first line for the context packet, and the `origin` in a project clone's `.git/config` to match the project to a client folder. Kinas's own code writes nothing under the home — not `data/`, not `state/`, not `config/`, not `projects/` — except `config/backend`, written once by `kinas crew setup` before any first mate exists. Kinas never runs `quota-axi` and never touches the wake.

## Consequences

Everything Firstmate already does — the queue, briefs, spawning, supervision, decisions, merges, teardown, away mode — is Firstmate's, and Kinas shows it; a feature Firstmate lacks is not built into Kinas. An answer from the Inbox costs the captain a paste and Enter in the first mate's pane, and in exchange it arrives as his own words in the chat Firstmate trusts, so the first mate acts on it. Kinas cannot see an answer arrive, so an item leaves only when Firstmate's snapshot stops listing it. A contract that moves at the pin is refused and the last reading stays (ADR 0004). Enforced by `packages/context/src/sources/firstmate.ts:1-4`, `:34` (the schema check), `cli/src/main.ts:3` ("Firstmate, Herdr and git are read, never written"), `docs/external/firstmate-home.md`, and — once Build 3 lands — the collector's guard tests with their negative controls (no writes under the home; the three read-only scripts the only ones run; `fm-send.sh` never run) named in `tasks/first-mate/build-spec.md` §6 and §12.
