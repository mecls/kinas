# Firstmate's home

## What it is

Firstmate (`github.com/kunchenguid/firstmate`) is the crew's conductor — the first mate — adopted, not built (ADR 0016, which supersedes 0014). It is a checkout of that repository whose `data/` (the queue, briefs, reports, learnings, `projects.md`, `backlog.md`), `state/` (windows, event logs, the session lock, `home-summary.json`) and `config/` (`backend`) are its own. Its scripts are the only contracts Kinas reads it through.

## Where

- **Today** (the context packet): the `firstmate_home` entry in `~/.config/kinas/config.json` (`packages/context/src/config.ts`), overridden by the env var `FM_HOME`; default `~/firstmate`.
- **Build 3** (the crew): Kinas's own clone at `<data dir>/firstmate` — `~/Library/Application Support/ai.sintralabs.kinas/firstmate` — at a pinned commit (`FIRSTMATE_PIN`, reviewed monthly) with `config/backend` = `herdr`; clone = home, so `FM_ROOT` (the checkout) and `FM_HOME` (the home) are the same path there. Deleting the data directory deletes the clone and the crew's project clones under it.
- Amended 2026-09-24 (the first mate): from slice 1 the app reads the home at `<data dir>/firstmate` and nowhere else (`crew/home.rs`); `FM_HOME` and `firstmate_home` still steer only the context packet, whose default moves to the same folder with its own slice.
- The captain's own clone of Firstmate, elsewhere on this Mac, holds a session lock (`state/.lock`) and is **out of bounds**: read-only, never a session, never a script, never a `git fetch` from Kinas or a build agent.

## Who reads it

- `packages/context/src/sources/firstmate.ts` — runs `bin/fm-fleet-snapshot.sh --json` (schema `fm-fleet-snapshot.v1`, 20 s timeout) for the launch screen and `kinas context`; reads `data/<id>/report.md` first lines for the reports list.
- Build 3's collector (`readers/crew/`) — the snapshot; `fm-afk-contract.sh field <name>` and `fm-project-mode.sh <name>` for Settings; the `origin` in a project clone's `projects/<name>/.git/config`, to match it to a client folder; and the modification times of `data/backlog.md` and `state/home-summary.json` as triggers only (the summary's contents are not read: it is invalid during normal running).
- Amended 2026-09-24 (the first mate, slice 2): Settings → Crew runs `fm-afk-contract.sh field entered` and `field expected_return` only while `state/.afk-contract` exists (the file is never opened), and `fm-project-mode.sh <name>` for each folder name under `projects/` — the names are listed, `data/projects.md` is not read. It also reads back `config/backend`, and `git -C <home> rev-parse HEAD` and `symbolic-ref --short -q HEAD` tell whether the clone is at the pin. These reads are not in ADR 0016's list; the build spec's §17 says why, for the captain.
- Amended 2026-09-25 (the first mate, slice 4): a task's clone is its `project` path from the snapshot, or — for a task
  not yet spawned, which has only Firstmate's name for its project — `projects/<name>`; either way only a path
  lexically under `<home>/projects/`, and only its `.git/config` (a `.git` file's `gitdir:` followed) is read, once per
  clone path per run. The task detail also checks whether `data/<id>/brief.md` exists, and resolves the report path
  Firstmate reports, only inside the home; both open in the reader on a click, read-only.
- Amended 2026-09-24 (the first mate): the snapshot runs in the app from slice 1, on the thread `kinas-crew`, at most once every 5 s, through `crew/firstmate.rs` — the only file that builds a path under `<home>/bin/` — with the login shell's `PATH`, `FM_HOME`, no inherited `HERDR*`, null stdin, and its process group killed at 20 s. The two triggers are watched on `state/` and `data/`, filtered to those two files.

## What it can do

Its scripts spawn workers into Herdr, run `git`, `gh`, `claude` and the crew tools, file tasks, deliver answers and tear sessions down. Kinas runs none of the ones that change anything: only `fm-fleet-snapshot.sh --json`, `fm-afk-contract.sh field` and `fm-project-mode.sh`, as processes with `FM_HOME` set. `fm-send.sh` is the first mate's channel to its workers; the captain's answers reach the first mate in its own chat, pasted from the clipboard (ADR 0017).

## Never

- Kinas's own code opens nothing for writing under the home: not `data/`, not `state/`, not `config/`, not `projects/`. Status files are append-only, provenance-guarded event logs; a foreign write fails toward a wake.
- Kinas never runs `fm-send.sh`, `fm-bootstrap.sh`, `fm-control.sh`, `fm-teardown.sh`, `fm-spawn.sh`, `fm-tasks-axi.sh`, `fm-captain-hold.sh` (any subcommand) or `fm-afk-return.sh`; never reads `state/*.status`, `.meta`, `.wake-queue`, `brief.md`, pane captures or the `.afk-contract`'s words; never parses `backlog.md`.
- Kinas never runs `quota-axi` (it reads Claude Code's credential and calls Anthropic) and never reads under `~/.claude`.
- Nothing about a task — title, id, path, label, URL, key, summary, answer, order text, a script's stderr — reaches the log or `kinas status --json`.
- Amended 2026-09-24 (the first mate): the collector's only log lines are `crew: snapshot {n} tasks, {d} decisions in {ms} ms` and `crew: snapshot failed in {ms} ms`; a failure's reason goes to `reader_status` for the Crew page, redacted, and never to the log.
