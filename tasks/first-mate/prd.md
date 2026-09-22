# PRD · The first mate inside Kinas

*Saved 2026-09-22 from the `/agent-build-spec` invocation, verbatim. The build spec written from it is
`tasks/first-mate/build-spec.md` (private; this PRD is tracked since 2026-09-22); where the two differ, the build spec wins (its §16 records why).*

Draft 2026-09-22, revised 2026-09-23 after the decision to run the first mate on Claude Code, and again the same day against Firstmate's architecture document (docs/architecture.md), which corrected how Kinas may read and mutate its state. Build 3 in the one-person plan. Follows the house process: questions first, then the task list, then the agent build spec, then the build.

## 1. What this is

Kinas gains a crew: one conductor, the first mate, that Miguel talks to, and disposable workers the first mate launches, supervises, and tears down, each in its own isolated copy of a repo on its own branch, each visible in Kinas while it works. Miguel never has to talk to a worker, but he can watch any of them live and, when he types into a worker's pane, that is an order the first mate folds into its supervision.

The conductor is Firstmate (kunchenguid/firstmate), running on Claude Code, on the Herdr backend, inside Kinas. Kinas does not reimplement it. Kinas installs it and its tools, gives it a home, and builds over its state the things a terminal-only conductor cannot give: the bridge page, the inbox, the order log, reconciliation you can see, and the usage numbers it dispatches on.

## Announcement

*Added 2026-09-22 by the process half-day (`tasks/_templates/prd.md` asks for it); the rest of this document is as saved.*

Kinas now has a crew. Press ⌘3 and the Crew page shows every worker the first mate has running: one lane per project, one card per task, with its state, its branch, its PR and its checks, live. Click a card and you are looking at what the worker was told to do and everything that happened since — including the orders you typed into its pane. When a worker needs a decision only you can make, it is in the inbox with the evidence; one click and a line of text answers it, through Firstmate's own script, and the worker carries on. You still talk to the first mate in its pane on the Work page, exactly as before; what changed is that you can see the whole fleet without asking.

## 2. The decision: adopt the conductor, build the bridge

The first mate runs on Claude Code because that is the subscription and the workflow, and Firstmate treats Claude Code as a co-primary harness with a verified turn-end guard: a tracked Stop hook re-arms the watcher at turn end and rewakes the session when the fleet needs it. That wake mechanism is the hardest part of a conductor and it already works; rebuilding it natively was the risk in the earlier draft, and it is gone.

| Firstmate provides | Kinas provides |
|---|---|
| The first mate session (Claude Code, `AGENTS.md` takes over on launch) | The launch: a Herdr session named `firstmate` in Firstmate's home, started from the Work page |
| Workers and scouts in Herdr sessions, each in a treehouse worktree | Visibility: every session on the Crew page, with a button to it and, later, an embedded pane |
| The task queue, briefs, reports, learnings (`data/`) | A read-only mirror in the store, fed by a collector that calls Firstmate's contracts (`fm-fleet-snapshot.sh --json`, `fm-crew-state.sh`, `state/home-summary.json`) and never parses its files; the reports opened in the reader |
| Live state: windows, event logs, PRs, pending decisions (`state/`) | The fleet board and the inbox, read from those contracts; the order log, written by Kinas in Kinas's store only |
| The watcher and the Stop hook (zero-token supervision, turn-end backstop) | Nothing; Kinas never touches the wake |
| Project modes (`no-mistakes`, `direct-PR`, `local-only`, `+yolo`) in `data/projects.md`; away mode as a posture entered in the pane | Display only: modes on the Crew page, the away posture and the return brief when the record exists; changes are asked of the first mate in its pane |
| Second mates, Relay | Available but off; Kinas shows a second mate as another conductor if one is created; Relay stays off |
| `treehouse`, `no-mistakes`, `gh-axi`, `tasks-axi`, `quota-axi`, optional `chrome-devtools-axi`, `lavish-axi` | The installer: per-tool approval, pinned versions, health in Settings. `quota-axi` is installed because Firstmate's dispatch reads it; Kinas stays the display |

Two consequences worth naming. First, the store does not own crew state in this build; it mirrors it, which is the durability split the reference design already described for the collector: live facts from Herdr's socket, durable facts from Firstmate's files and git. Second, every mutation Kinas ever needs is a Firstmate script run as a process: `fm-send.sh --resolve-key` to answer a decision (it appends the closing line and delivers the answer to the worker), `fm-captain-hold.sh` to release a held item, `fm-control.sh` for interrupt, exit, and relaunch, `fm-tasks-axi.sh` for the queue. Status files are append-only, provenance-guarded event logs; a foreign write fails toward a wake, so Kinas writes nothing under `data/` or `state/`, ever.

## 3. Who does what

- **The captain.** Miguel. Talks to the first mate in its pane on the Work page. Decides merges, credentials, anything destructive, anything the project mode does not delegate. Can watch any worker; can type into one, which becomes an order.
- **The first mate.** Firstmate on Claude Code. Takes the ask, picks the project, decides ship or scout and how it ships, files the task with the captain's words verbatim as acceptance criteria plus its own build spec, launches and supervises workers, answers their questions, decides what its mode allows, reports outcomes. Read-only over the projects except for its guarded operations (its hard rule 1); it keeps its own clones under its home, and the captain's checkouts under `~/SintraLabs` stay untouched.
- **Workers.** One per task, disposable: a fresh Claude Code session in a treehouse worktree on its own branch; implement, run the project's checks, commit, push, PR through the project's mode, torn down after the merge.
- **Scouts.** Same, with a report as the deliverable, at `data/<id>/report.md`, opened in the reader.
- **Second mates.** Off in this build. If the captain creates one later, the Crew page shows it as a second conductor with its own fleet.

## 4. How one task runs

Exactly as Firstmate runs it, with what Kinas adds in brackets.

1. The captain asks in the first mate's pane.
2. The first mate files the task in its queue with the captain's words as acceptance criteria and its build spec as the brief. [The collector sees the new task within a second; the card appears on the fleet board as queued.]
3. The first mate launches the worker: a treehouse worktree, a Herdr session named `fm-<task>`, a fresh Claude Code session with the brief. [The card turns working; the session is listed; the button to it appears.]
4. The worker builds, runs checks, commits, pushes; on `no-mistakes` it runs the validation pipeline, then the PR and CI. [The PR and its checks appear on the card, read by Kinas through `gh`.]
5. Firstmate's watcher sleeps on the fleet and wakes the first mate through the Stop hook when something needs it: finished, stuck, needs a decision, went quiet. Anything only the captain can decide goes to Firstmate's decision inventory with evidence and a recommendation. [The inbox mirrors the open-decisions fold from the fleet snapshot; approving in the inbox runs `fm-send.sh <task> --resolve-key <key> "<answer>"` as a process, which is how the actor that answers is meant to close a decision, never a file edit and never a pane.]
6. CI green: one message in the pane with the PR link; the captain says merge; the first mate merges, tears down, refreshes its clone, starts the next queued item. [The card turns done; the session disappears from the list; teardown is visible.]

If the captain types into a worker's pane, Firstmate treats it as an order and reconciles. [Kinas records it on the task's timeline as an order, with the text and the time, because the app knows the keystrokes came from the webview.]

## 5. What Miguel sees

The Crew page (⌘3) is the bridge, built for the one thing a chat-only conductor cannot give: visibility.

- **The fleet board.** One lane per project; in each lane, the workers and scouts as cards: title, kind, state (queued, working, blocked, needs decision, PR open, CI red, ready to merge, done), elapsed time, the branch and PR, the provider it runs on and the slot it occupies. Click a card for the task detail.
- **The task detail.** The brief (acceptance criteria and build spec, read from Firstmate's task files), the live timeline (Firstmate's event log merged with the captain's orders), the PR and its checks, the report for scouts (in the reader), the decision if one is pending, and a button to the worker's session in the Work page. Embedded panes are the last slice.
- **The inbox.** Every open decision from the fleet snapshot's fold, with the evidence and the recommendation; approve, deny, or answer; merges live here too. Every action runs the corresponding Firstmate script (`fm-send --resolve-key`, `fm-captain-hold`, the merge through the first mate), never a file edit and never a pane.
- **The first mate's pane.** The Work page keeps the `firstmate` session as its default target; the Crew page has a button to it.
- **The Usage page** gains the crew's share of each provider's window, read from the same numbers Firstmate dispatches on.
- **The launch screen** lists crew and sessions from the mirror, which is what it was always meant to read.

**Screens** *(added 2026-09-22 by the process half-day; the mockups are Gate 1 work, empty until then)*:
- `mockups/board.html` — the Crew page with the fleet board
- `mockups/task-detail.html` — the task detail in the right panel
- `mockups/inbox.html` — the inbox

## 6. What Kinas builds

- **The installer.** `kinas crew setup`, and the same flow from the Crew page's empty state: clone Firstmate at a pinned commit into Kinas's data directory as its home (`FM_HOME`), set `backend=herdr`, install the helper tools with per-tool approval and pinned versions (`treehouse`, `no-mistakes`, `gh-axi`, `tasks-axi`, optionally `chrome-devtools-axi` and `lavish-axi`), verify `gh auth`, and show every tool's state and version in Settings. The app refuses to launch the first mate while a required tool is missing, with one line.
- **The launcher.** One action that opens a Herdr session named `firstmate` in Firstmate's checkout (`FM_ROOT`) and starts `claude` there, through Herdr's CLI with a fixed argv, the way Open in the terminal works today. Nothing is typed. Before creating it, the launcher checks for an existing primary session (one per home; Firstmate holds a fleet lock) and attaches instead of duplicating. `config/backend` is set to `herdr` explicitly at install, and the session is never started inside tmux, because Firstmate's auto-detection is innermost-first.
- **The collector.** A Rust service that watches `state/home-summary.json` (published atomically with a freshness epoch after every state change) and, on change or on a bounded cadence, runs `bin/fm-fleet-snapshot.sh --json` (schema `fm-fleet-snapshot.v1`) and, per task on demand, `bin/fm-crew-state.sh <id>`; Herdr's socket supplies live session state; `gh` supplies PR checks. It writes the mirror tables (`crew_tasks`, `crew_workers`, `crew_events`, `crew_decisions`) in the store, one writer as always, with the durability split stated: live state best-effort and stale-marked, durable facts from the snapshot and git. It never reads status logs, pane captures, or hashes itself: the doc is explicit that a log's last line is not its state, and the open-decisions fold is Firstmate's to compute.
- **The Crew page.** Board, task detail, inbox, as above.
- **The order log.** Keystrokes into a worker's pane, recorded as an order row on the task with the text and the time.
- **Reconciliation you can see.** On every start, the collector compares Firstmate's state against Herdr's sessions and the worktrees on disk and lists every mismatch in the inbox, never repairing silently; Firstmate's own reconciliation runs when the first mate next starts, and Kinas shows what it did.
- **Settings.** Display of project modes and `+yolo` from `data/projects.md`, the away posture when `state/.afk-contract` exists, the installed Firstmate commit against the pinned one (drift is shown, not fought, because `/updatefirstmate` fast-forwards from origin), and the tool health list. Changes to modes and the project registry are asked of the first mate in its pane; Kinas edits none of them.

## 7. What Kinas does not build

The queue, the briefs, the watcher, the Stop hook, the turn-end guard, the decision fold, worktree creation and return (treehouse's pool and locks), the merge, teardown, away mode, second mates, Relay. Kinas never kills a session, deletes a worktree, or interrupts a worker; those are `fm-control.sh` and `fm-teardown.sh`, invoked by the first mate. All of that is Firstmate's, pinned. If Firstmate breaks the contract Kinas reads twice, Kinas vendors it, per the existing rule for every adopted tool.

## 8. Invariants (added to the ones the app already obeys)

- Kinas never types into any pane, including the first mate's. Wakes are Firstmate's watcher through its Herdr backend; decisions from the inbox go through Firstmate's files; the launcher uses Herdr's CLI with a fixed argv. A test asserts zero PTY writes from the app across the whole flow.
- The captain typing into a pane is the one exception and is recorded as an order.
- Kinas is read-only over Firstmate's home. It writes nothing under `data/`, `state/`, or `config/`; every mutation is a Firstmate script run as a process. Firstmate's checkout (`FM_ROOT`) is never opened as a project, never appears in the sidebar or the context packet, and nothing in Kinas ever checks out a branch in it (a named branch there is what Firstmate calls a tangle).
- Kinas's own folder workspaces in Herdr never target Firstmate's home or its worktrees; Firstmate's Herdr backend owns task placement, including its disposable presentation workspaces, and the session list follows it.
- The store mirrors crew state; it does not own it. The CLI stays read-only; no command channel is needed in this build.
- Nothing about a task reaches the log or `crew status --json` except durations, counts, states, and PR numbers. Briefs, report paths, worktree paths, and PR URLs live in rows only; a new test adds them to the forbidden strings.
- The captain's checkouts under `~/SintraLabs` are never touched by the crew; Firstmate's clones live under its own home. Two copies of each repository on disk is the design, not a defect: the desk is the captain's, the clones are the crew's, and GitHub is the meeting point (the captain pushes what the crew should build on and pulls what the crew merged). Firstmate is never pointed at the captain's checkout to avoid the duplicate; that would break the boundary and share `.git` with half-done work.

## 9. Acceptance

- AC-1: `kinas crew setup` installs Firstmate at the pinned commit and every required tool with per-tool approval; Settings shows each tool's version and health; a missing required tool blocks the launcher with one line.
- AC-2: The launcher opens the `firstmate` Herdr session in `FM_ROOT` running Claude Code, through Herdr's CLI, with zero PTY writes from the app; a second launch attaches to the existing session instead of creating another.
- AC-3: One ask in the first mate's pane produces a card on the fleet board within a second, with the captain's words as acceptance criteria in the task detail.
- AC-4: A launched worker shows working, with its session listed and a button to it; its PR and checks appear on the card without a manual step.
- AC-5: An open decision in the fleet snapshot appears in the inbox with evidence and recommendation; approving it in the inbox runs `fm-send --resolve-key`, the worker resumes, and a test proves Kinas wrote no file under Firstmate's home.
- AC-6: Merge and teardown are visible on the board: the card turns done, the session leaves the list, the worktree is gone.
- AC-7: Two independent tasks run in parallel in two lanes; a third waits when the provider slot is full, and the Usage page shows the crew's share.
- AC-8: Typing into a worker's pane produces an order row on the task's timeline within a second.
- AC-9: Killing the app mid-task and relaunching lists every mismatch in the inbox with no silent repair; the worker's session is still alive in Herdr; the first mate reconciles on its next start and Kinas shows what changed.
- AC-10: No brief, report path, worktree path, or PR URL appears in the log or in `crew status --json`, proven by the forbidden-strings test.
- AC-11: A fake worker (a script that writes Firstmate-shaped task and state files and opens no PR) drives AC-3 through AC-9 in e2e without Herdr's `default` session or a token of quota.

## 10. Open questions, to answer before the task list

1. **Which Firstmate commit is pinned**, and what is the upgrade cadence (the monthly rule, or on Firstmate's own release signal once it has one)?
2. **Herdr backend readiness.** Firstmate's Herdr backend was verified against 0.7 and 0.8; the installed Herdr is 0.9. A two-hour probe comes first: two workers on a scratch repo, sessions visible, states tracking reality, clean teardown. If it fails, `tmux` is the fallback backend and the Work page shows tmux windows instead; decide now whether that fallback is acceptable.
3. **Worktrees: treehouse or Orca?** Treehouse by default (the simpler tool, no new terminal); Orca only if the probe shows a reason.
4. **Quota source. Decided: install `quota-axi`.** Dispatch profiles resolve arrays from that tool's output through Firstmate's own procedure; Kinas remains the display and does not impersonate it.
5. **The decision contract. Decided: there is no file.** Answers run `fm-send.sh <task> --resolve-key <key>`; held items run `fm-captain-hold.sh`; lifecycle runs `fm-control.sh`. The inbox's remaining question is only the exact argv of each, read from the script headers.
6. **The fleet snapshot contract. Decided: `fm-fleet-snapshot.v1` and `state/home-summary.json`.** Which fields the board relies on is read from the script header; anything not in the schema is not shown.
7. **The captain's orders. Decided: Kinas records, in its own store only.** Firstmate keeps direct typing conversational and unmarked; it never becomes a status-log record, and Kinas never writes one.
8. **Away mode. Decided: Firstmate's, entered in the pane.** The captain's away words are read back and recorded verbatim by design, so Kinas offers no form; it shows the posture and renders the return brief. The spend cap is Firstmate's.
9. **Project allowlist. Decided: `data/projects.md`, displayed, not edited.** Adding a project is asked of the first mate.
10. **Slices.** Proposed: (0) the Herdr probe and a read of Firstmate's contracts (fleet snapshot, decision file, event log); (1) the installer and the launcher; (2) the collector and the mirror tables, with the fake worker; (3) the fleet board and task detail with a link to the session; (4) the inbox and the decision write; (5) the order log; (6) reconciliation on start; (7) Settings for modes, away mode, and the allowlist; (8) the Usage page's crew share; (9) embedded panes, last. Confirm or reorder.

## 11. Decisions taken

- The first mate is Firstmate on Claude Code, on the Herdr backend, in a home under Kinas's data directory, pinned. Kinas adopts the conductor and builds the bridge.
- Kinas never types into a pane and never writes into Firstmate's home; wakes are Firstmate's Stop hook and watcher, decisions and lifecycle run Firstmate's scripts as processes, launches go through Herdr's CLI.
- The store mirrors crew state through a collector; the CLI stays read-only; no command channel in this build.
- Embedded panes are the last slice; the board links to the Work page until then.
- The collector consumes contracts (`fm-fleet-snapshot.sh --json`, `fm-crew-state.sh`, `home-summary.json`) and never a log's last line, a pane capture, or a hash.
- `quota-axi` is installed; away mode and project modes are Firstmate's and displayed, not edited; Firstmate's checkout is excluded from projects, the sidebar, and the context packet.

---

*Answered 2026-09-22 with Miguel, before the build spec (see `build-spec.md` §16):* Q1 → `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540`, reviewed monthly · Q2 → no tmux fallback; a failed probe stops the build · Q3 → treehouse · Q10 → reordered: probe, mirror, installer + launcher, board, inbox + orders, reconciliation + settings; embedded panes moved to a follow-up spec. Also: `quota-axi` is installed for Firstmate but **Kinas never runs it** (it reads Claude's credential and calls Anthropic, which Kinas's own rule forbids); the "session named `firstmate`" is a **workspace** labelled `firstmate` in the session Kinas's pane is attached to; the inbox holds what the contracts carry (keyed open decisions and captain-held tasks), answered by free text.
