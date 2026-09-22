# Firstmate's home

## What it is

Firstmate (`github.com/kunchenguid/firstmate`) is the crew's conductor — the first mate — adopted, not built (ADR 0014). It is a checkout of that repository whose `data/` (the queue, briefs, reports, learnings, `projects.md`, `backlog.md`), `state/` (windows, event logs, the session lock, `home-summary.json`) and `config/` (`backend`) are its own. Its scripts are the only contracts Kinas reads it through.

## Where

- **Today** (the context packet): the `firstmate_home` entry in `~/.config/kinas/config.json` (`packages/context/src/config.ts`), overridden by the env var `FM_HOME`; default `~/firstmate`.
- **Build 3** (the crew): Kinas's own clone at `<data dir>/firstmate` — `~/Library/Application Support/ai.sintralabs.kinas/firstmate` — at a pinned commit (`FIRSTMATE_PIN`, reviewed monthly) with `config/backend` = `herdr`; clone = home, so `FM_ROOT` (the checkout) and `FM_HOME` (the home) are the same path there. Deleting the data directory deletes the clone and the crew's project clones under it.
- The captain's own clone of Firstmate, elsewhere on this Mac, holds a session lock (`state/.lock`) and is **out of bounds**: read-only, never a session, never a script, never a `git fetch` from Kinas or a build agent.

## Who reads it

- `packages/context/src/sources/firstmate.ts` — runs `bin/fm-fleet-snapshot.sh --json` (schema `fm-fleet-snapshot.v1`, 20 s timeout) for the launch screen and `kinas context`; reads `data/<id>/report.md` first lines for the reports list.
- Build 3's collector (`readers/crew/`) — the snapshot, `state/home-summary.json` (schema `fm-secondmate-home-summary.v1`), `fm-crew-state.sh <id>`, and the mtime of `data/backlog.md` as a trigger only.

## What it can do

Its scripts spawn workers into Herdr, run `git`, `gh`, `claude` and the crew tools, file tasks, deliver answers and tear sessions down. The one mutating script Kinas ever runs is `bin/fm-send.sh <id> --resolve-key <key> <text>` — as a process, with `FM_HOME` set, on a click in the inbox.

## Never

- Kinas's own code opens nothing for writing under the home: not `data/`, not `state/`, not `config/`, not `projects/`. Status files are append-only, provenance-guarded event logs; a foreign write fails toward a wake.
- Kinas never runs `fm-bootstrap.sh`, `fm-control.sh`, `fm-teardown.sh`, `fm-spawn.sh`, `fm-tasks-axi.sh` or `fm-captain-hold.sh hold|answer`; never reads `state/*.status`, `.meta`, `.wake-queue`, `brief.md`, pane captures or the `.afk-contract`'s words; never parses `backlog.md`.
- Kinas never runs `quota-axi` (it reads Claude Code's credential and calls Anthropic) and never reads under `~/.claude`.
- Nothing about a task — title, id, path, label, URL, key, summary, answer, order text, a script's stderr — reaches the log or `kinas status --json`.
