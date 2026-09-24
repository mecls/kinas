# The first mate inside Kinas — PRD (Build 3)

*Revised 2026-09-23 with the captain, and now the one current product document for Build 3. It takes in the draft
of 2026-09-22 (in git history), the decisions recorded with the build spec that day, the captain's consolidated plan
of 2026-09-23, a review of all three against the code at `1394be7` and against Firstmate itself at the pin, and the
captain's five answers of 2026-09-23 (§7). Where this document and `build-spec.md` differ, **this one wins** until
the spec is revised to match; the review's detail (every field, argv and stale reference) is kept privately beside it
for Gates 2 and 3.*

*Reopened the same day after slice 0's probe, with the captain's three answers (§7): Firstmate takes a captain's
answer only in the first mate's chat, so the Inbox runs no Firstmate script and hands every answer to that chat on the
clipboard (rules 5–7, ADRs 0016 and 0017); a crew project's repository is read from its clone's git config (rule 18);
Firstmate's home summary is a trigger only, never a Reconcile line (rule 8).*

## 1. Objective

Kinas gains a crew. The conductor is Firstmate (`github.com/kunchenguid/firstmate`), running on Claude Code, on Herdr,
in a home under Kinas's data directory, pinned to one commit. The captain talks to it — the first mate — in a pane on
the Work page, and it files tasks, launches disposable workers in their own worktrees, supervises them, asks the
captain only what it must, merges and tears down. Kinas does not rebuild any of that. It installs Firstmate and its
tools, launches it, reads its fleet through Firstmate's own published contracts into a mirror in Kinas's store, and
shows what a terminal-only conductor cannot: a Crew page with every task live, a task detail in the right panel, an
Inbox of everything waiting on the captain, which hands each answer to the first mate's chat, the orders he typed into
a worker's pane, mismatches it can see after a restart, the crew's night on Home, the waiting count in the sidebar and
the menu bar, and the crew's in-progress features in `kinas context`. It replaces the Crew and Inbox pages' "arrives
with Build 3" placeholders and Home's empty Overnight and Waiting on you sections. It is built now because the design
system that the Crew page composes has shipped, and every later build (ops agents, the phone) reads the same Inbox.

## Announcement

Kinas now has a crew. Talk to the first mate in its pane on the Work page — Kinas opens on it every morning — and
press ⌘3 to see everything it has running: one lane per client folder, one card per task, with its state, its PR and
its checks, live. Click a card and the right panel shows what the worker was asked, everything that happened since,
and the orders you typed into its pane. When something needs you, it is in the Inbox, counted in the sidebar, on Home
and in the menu bar. Click Approve, or type your answer, and Kinas puts it on the clipboard and opens the first mate:
paste it, press Enter, and the first mate takes it from there — the one place Firstmate trusts a captain's call. Home
now says what the crew did while you were away, and a right-click on a client folder adds it to the crew.

## 2. Business rules (invariants — never violate)

### The boundary with Firstmate

1. **Firstmate is the first mate; Kinas builds only the bridge.** Firstmate is installed as Kinas's own clone at
   `<data dir>/firstmate` (the clone is the home), at commit `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540`, reviewed
   monthly. The queue, briefs, spawning, supervision, wakes, decisions, merges, teardown and away mode are
   Firstmate's; a feature Firstmate lacks is not built into Kinas (ADR 0016, which supersedes 0014). The captain's own
   clone of Firstmate, if one ever exists elsewhere, is never read by a session, a script or a fetch from Kinas.
2. **Kinas never types into any pane.** No code path in Kinas sends a keystroke to its own terminal or to any Herdr
   pane. Launching, focusing and asking about panes go through Herdr's command line with a fixed argument list
   (`workspace create`, `workspace focus`, `pane run`, `pane process-info`, `api snapshot`). Because text typed at a
   running Claude Code arrives as a prompt (`keymap.md`), the only keystrokes that ever reach a pane are the
   captain's own (rule 17).
3. **Kinas's one launch argument to the first mate is one fixed sentence.** Add to crew (§4) starts the first mate
   with one fixed sentence — *Add the project https://github.com/‹owner›/‹repo› to the crew: clone it from GitHub, not
   from my desk, and ask me which mode it ships in.* — whose only variable part is a GitHub URL Kinas built from the
   folder's `origin` and validated (letters, digits, `.`, `_`, `-` in the owner and the name, nothing else). Nothing
   anyone typed and nothing read from a file enters that command. When the first mate is already running, Kinas
   says nothing to it: the sentence goes on the clipboard and the first mate's pane is shown, because a second first
   mate in one home is read-only (Firstmate's lock) and typing is rule 2 (ADR 0015, carried into ADR 0017). The
   Inbox's answer lines (rule 6) are the only other words Kinas prepares for the first mate, and they never travel as
   an argument.
4. **Kinas writes nothing under Firstmate's home.** Not `data/`, `state/`, `config/` or `projects/`. The one file
   ever written there is `config/backend` (`herdr`), once, by `kinas crew setup`, before any first mate exists.
   Firstmate's status files are append-only, provenance-guarded event logs, and a foreign write fails toward a wake.
5. **Kinas runs no Firstmate script that changes anything.** It runs three, all read-only:
   `bin/fm-fleet-snapshot.sh --json`, `bin/fm-afk-contract.sh field <name>` and `bin/fm-project-mode.sh <name>`.
   Never `fm-send.sh` — it is the first mate's channel to its workers, and slice 0's probe showed a captain's approval
   sent through it closing a held landing while nothing landed — and never `fm-control.sh`, `fm-teardown.sh`,
   `fm-spawn.sh`, `fm-bootstrap.sh`, `fm-tasks-axi.sh`, `fm-captain-hold.sh` (any subcommand) or `fm-afk-return.sh`
   (run bare, it ends away mode). Kinas never kills a session, deletes a worktree or checks out a branch in the home
   (ADR 0016).
6. **The captain answers in the first mate's chat; Kinas only prepares the line.** Firstmate acts on a captain's call
   only when it arrives in the first mate's chat: the probe's approval through `fm-send.sh` was refused as "not from
   you in this chat", and the landing waited for the captain's words in the pane. So every item — a keyed decision or
   a held task, its worker alive or gone — is answered the same way: its action puts one line on the clipboard and
   goes to the first mate (the launcher, rule 23: focused if it runs, started if not), and the captain pastes it and
   presses Enter. The line is `On <task id> (<key>): <answer>`, without the parenthesis when the key is the task's own
   id (a held task): `Approved — go ahead.` for Approve, `Denied — <text>` for Deny, the text itself for Answer. The
   id and the key are Firstmate's own, from the snapshot; the text is what the captain typed. Nothing is typed into
   any pane (rule 2), nothing is sent, and no script runs (ADR 0017).
7. **Only Firstmate closes an item.** Copying an answer changes neither the list nor the count: the item says
   `Copied 15:02 — paste it into the first mate's pane` and keeps its actions until the snapshot stops listing its key
   (a keyed decision) or stops holding the task (a held task). Kinas never marks an item answered, because it cannot
   see the paste reach the first mate, and the close is Firstmate's own append.
8. **Only Firstmate's contracts are read, and only what they carry is shown.** Kinas reads
   `bin/fm-fleet-snapshot.sh --json` (schema `fm-fleet-snapshot.v1`), `fm-afk-contract.sh field <name>`,
   `fm-project-mode.sh <name>`, the `origin` in a task's project clone's `.git/config` (rule 18), Herdr's `api
   snapshot` and `pane process-info`, and `gh pr view`. The modification times of `data/backlog.md` and `state/home-summary.json` are triggers only; the
   summary's contents are not read, because slice 0's probe found it invalid during normal running (while a worker
   spawns, while a ship waits to land). It never reads status logs, task metadata, pane captures, the away contract's
   words or the backlog's contents. A contract whose schema changed is refused with one line and the last good reading
   stays on screen (ADR 0004). Nothing is shown that the contracts do not carry: there is no recommendation, no
   evidence, no branch, no start time and no provider slot in them (read at the pin, 2026-09-23), so none is drawn.
   *(Clarified at Gate 2, 2026-09-23: `kinas context` also reads a scout report's first line, as it did before Build 3
   — a report is a deliverable meant for reading.)*
9. **Quotas stay Kinas's own.** Kinas never runs `quota-axi` (it reads Claude Code's login and calls Anthropic) and
   never reads under `~/.claude`. `quota-axi` is installed only because Firstmate runs it. The crew's line on Usage
   counts tasks per harness; it is never a share of a quota.
10. **Firstmate's home is never a project, and the desk is never the crew's.** The home is outside the projects
    folder, so it is never a client folder, never in the sidebar and never in the context packet's Projects; the
    reader opens a file under it only from a click (a report or a brief). Every repository has two copies by design:
    the desk (the captain's folder) and the crew's clone (under the home). GitHub is where they meet. Firstmate is
    never pointed at the desk by Kinas, and Add to crew passes the GitHub URL, never the folder's path. (Given a
    path in the pane, Firstmate links the folder in place instead of cloning it — slice 0's probe. That is the
    captain's choice; Kinas shows such a project like any other.)

### The mirror

11. **The store mirrors the crew; it never owns it.** Kinas's crew rows are rebuilt from Firstmate's contracts. The
    app is still the store's one writer (ADR 0001) and the CLI still opens it read-only.
12. **The mirror never deletes.** A task the snapshot stops listing is marked gone, never removed; the timeline only
    grows; a decision is closed, never erased. What is shown is a view: a done task for 7 days after it finished, a
    gone task for 24 hours.
13. **A task filed in the pane is a card within 5 seconds.** The snapshot runs when `data/backlog.md` or the summary
    changes (after 500 ms of quiet), when the Crew or Inbox page opens, and every 60 s while the window is visible
    (300 s hidden) — never twice within 5 s. Filing a task does not republish Firstmate's summary (it can lag 5
    minutes), and the snapshot itself probes each task with `gh` and `no-mistakes` under 10 s limits.
14. **A worker's pane is known only by the snapshot's `endpoint.target`**, split at its first colon into the session
    and the pane id (a pane id contains a colon itself). Never by a tab's label, never by a folder.
15. **Stale is said, not hidden.** Herdr's view older than 15 s disables Open its pane and says `pane state stale`;
    the mirror older than 60 s reads `stale · as of 09:31:12` in the Crew page's caption; a Herdr that does not
    answer makes only the live parts stale.

### What the captain sees

16. **One waiting count, everywhere.** Waiting on the captain = the open keyed decisions plus the captain-held tasks
    in the last snapshot; a copied answer still counts until Firstmate closes it (rule 7). Reconcile lines are
    information and never count. The
    sidebar's Inbox row, the "N waiting on you" button on Home and on Crew, and the menu bar all show this one number
    from the same reading; at 0 none of them shows a number.
17. **An order is recorded, never generated.** A line the captain types into Kinas's terminal becomes an order on a
    task only if, when he presses Enter, Herdr says the focused pane is that task's worker pane. Typed into the first
    mate's pane or a plain shell, it is dropped without a row and without a log line. It is redacted (`Bearer …`,
    `sk-ant-…`), stripped of NUL and capped at 2,000 characters, and kept in Kinas's store only; Firstmate sees the
    typing as conversation, never as a record.
18. **A client folder and a crew project are matched by their GitHub repository.** The snapshot names no GitHub
    repository: a task's `project` is the path of Firstmate's own clone, under `<home>/projects/` (slice 0). Its
    repository is the `origin` in that clone's `.git/config`, read as a file — Kinas runs no `git` in the home — and
    only for a path under `<home>/projects/`, checked before it is read. A project belongs to the client folder whose
    `origin` names the same GitHub owner and repository (HTTPS or SSH form, `.git` dropped, case ignored), never by
    name. A project no folder matches gets a lane under the repository's name, with no chip, after the folders' lanes;
    one whose clone has no readable `origin`, under its folder's name. A hidden folder keeps its lane on Crew (hiding
    is for the sidebar and Home); a removed folder is forgotten, so its tasks fall into a repository-named lane.
19. **A lane exists while its folder has a task on the board.** Its header counts in Firstmate's own words —
    `2 in flight · 1 queued` — never provider slots, which Firstmate does not publish. "In flight" is any task
    started and not finished, whatever its word (a task waiting on a decision is in flight, not working).
20. **One word per task, first match wins:** gone → **gone**; finished → **done**; failed → **failed**; a pending
    decision, parked, or held for the captain → **needs decision**; blocked → **blocked**; paused → **paused**; a PR
    that is open, not a draft, mergeable and with at least one check, all green → **ready**; a failing check →
    **CI red**; any PR → **PR open**; working → **working**; queued → **queued**; anything else → **unknown**.
21. **Overnight means since you were last here.** Kinas notes when its window last had focus, at most once a minute.
    Sixty minutes without focus end a session. Overnight runs from the end of the last session to now, capped at 24
    hours, and says so: `since 23:40 yesterday, 9 h 20 m`. A folder's row counts the tasks of its lane with any
    event in that window as done, working (queued, working, PR open, paused, unknown), waiting on you (needs
    decision, ready) or failed (failed, blocked, CI red).
22. **The Work pane opens on the first mate, once.** When Kinas starts and the attached Herdr session has a
    `firstmate` workspace, Kinas focuses it, so the pane shows the first mate when the session attaches. After that
    Kinas moves the pane only on a click (First mate, Open its pane, Launch task, Open in the terminal); the pane is
    the captain's and never changes under his hands. *(Clarified at Gate 2, 2026-09-23: "when Kinas starts" means
    Herdr answered within 10 s of Kinas starting; when its server was not up yet, Kinas focuses nothing, then or
    later.)*
23. **The launcher makes one first mate.** At most one `firstmate` workspace per session — Firstmate's own label for
    its home workspace, so one it made itself is found too. `claude` runs there only when Herdr says `claude` is not
    already its foreground program; a second click focuses it. A missing required tool, a home on a branch other
    than `main` (a tangle), or no Herdr server is refused with one line, and nothing moves.
24. **The terminal chrome says only what Kinas knows.** It shows the session and the focused workspace's label; a
    status badge only when the focused pane is a worker's, with that task's word; the profile `claude` when Herdr
    reports it as the pane's foreground program, `plain shell` for the shell. (The chrome's old badge said "working"
    without reading anything.)
25. **A status file gives two kinds of line and nothing else.** `kinas context` lists in-progress features from
    `tasks/*/status.md` in the projects it already lists, reading only `- Gate N · <name>: <state>` and the
    `- [ ]` / `- [x] Slice …` lines. A feature is in progress while any gate is not `APPROVED` or any slice is
    unticked. A file that does not parse is listed as `status unreadable`, never guessed.

### Privacy, and the Mac

26. **Nothing about a task reaches the log or `kinas crew status --json`** beyond durations, counts, states and PR
    numbers: no title, id, folder, path, URL, key, question, answer, order text or a script's error text. Every crew
    test fixture carries a marker that the forbidden-strings check looks for in the log and in that output.
27. **The webview gains no capability.** Every new door is a Rust command.
28. **No test and no probe touches Herdr's `default` session.** The end-to-end tests use a throwaway Herdr session
    and a fake Firstmate home (stub scripts over fixtures), and none starts `claude`. The slice-0 probe sets
    `HERDR_SESSION` to its own session and proves its workers land there, because Firstmate falls back to `default`
    when it is unset.
29. **Every crew process gets the login shell's `PATH`, `FM_HOME`, no inherited Herdr variables, no input, and a time
    limit:** snapshot 20 s, `gh` 10 s, the two Settings scripts 3 s, tool checks 5 s, Herdr 3 s.
    An app started by launchd sees only `/usr/bin:/bin`, and `gh`, the node tools, `herdr` and `claude` live
    elsewhere.
30. **The terminal is never remounted.** The Crew and Inbox pages mount no terminal (ADR 0002); panes embedded in
    Kinas are a later spec.

## 3. Flows

**Setting up.** The Crew page, with nothing installed, says `Run this in the Work pane:` above `kinas crew setup` and
a Copy button. The command prints each step before it runs it and asks `y/N` for each tool: the prerequisites (`git`,
`gh`, `node`, `npm`, `jq`, `python3`, `herdr`, `claude`) and where to get a missing one; `gh auth status`; the clone at
the pin (`already at f9f74a1` when it is; a changed clone is refused with `<home> has local changes; Kinas will not
touch it`); `config/backend`; the tools at pinned versions (`npm install -g <tool>@<version>`, or a release tarball
checked against its published checksum into `~/.local/bin` — never `curl | sh`); a line per tool's `setup hooks`
step, printed and never run, because those write under `~/.claude`. It ends with a table, `ok 0.2.5` or `missing`
per tool, and exits 0 only when every required tool is there and `gh` is signed in. A failed step is printed with what
to do and the rest continue. The Crew page then asks **Start the first mate now?** above **Launch the first mate**.

**Launching.** Launch the first mate → the launcher (rule 23) finds or creates the `firstmate` workspace in the
attached session, in the home, and runs `claude` there → the Work page shows with the terminal holding the keys →
the first time, Claude Code asks whether to trust the folder; the captain answers once → Firstmate's session start
runs. A second click, or **First mate** on Crew, or Launch task on Home, focuses the same workspace.

**Every morning.** Open Kinas → the pane is focused on the first mate (rule 22) → Home shows Overnight with a row
per client folder and Waiting on you with up to three items → the menu bar and the sidebar show the same waiting
count.

**A project.** In the pane: "add kinas, ship mode no-mistakes"; the first mate clones and registers it, and its lane
appears once it has a task. Or right-click the client folder → **Add to crew**: with the first mate stopped, it
launches with the one sentence of rule 3; with it running, the sentence is copied, the pane is shown, and the sidebar
says `The ask is on the clipboard — paste it into the first mate's pane.` A folder with no GitHub remote, or already
in the crew, shows the item disabled with the reason as its tooltip.

**A task, from ask to done.** Ask in the pane → a **queued** card in its folder's lane within 5 s (rule 13) → the
worker starts in its own worktree and a `fm-<id>` tab → **working**, and **Open its pane** appears → it pushes →
**PR open** with `PR #123 · checks 3/4 · 1 failing` (→ **CI red**) read through `gh` → green and mergeable →
**ready** → the captain says "merge it" in the pane → **done**, the tab and the worktree gone, the timeline showing
it. A scout ends with **Open the report** instead of a PR.

**A decision.** A worker asks something only the captain can decide, or the first mate holds a task for him → an item
on the Inbox, with the count up by one everywhere → **Approve** puts `On <id> (<key>): Approved — go ahead.` on the
clipboard at once; **Answer** and **Deny** open a text box, and **Copy and go** puts the line with his text on it (a
denial as `Denied — <text>`) → Kinas goes to the first mate (rule 23: focused if it runs, started if not), the Work
page shows with the terminal holding the keys, and the sidebar says `Your answer is on the clipboard — paste it into
the first mate's pane.` → he pastes it and presses Enter → the first mate records the answer its own way and the
worker carries on → the next snapshot no longer lists the item: it leaves and the count drops. Until then the item
says `Copied 15:02 — paste it into the first mate's pane` and keeps its actions, so it can be copied again. The same
item and actions sit in the task's detail and, compact, on Home. When the launcher refuses (a missing tool, no Herdr
server), its one line shows, the clipboard still holds the answer, and nothing moves.

**A held task.** The same item and the same route, whether its worker is alive or gone (rule 6); its line names the
task alone: `On <id>: Approved — go ahead.`

**An order.** The captain clicks **Open its pane** and types into the worker → at Enter, an `order` row appears on
the task's timeline within a second (rule 17) → the first mate reads it as conversation.

**A restart.** Kinas quits mid-task → the workers and the first mate carry on in Herdr → Kinas starts → the mirror
still has every row → one snapshot → the Inbox's **Reconcile** group lists every mismatch, one line each, and repairs
nothing: an in-flight task whose pane is dead or absent, an in-flight task whose worktree is gone, a task in flight in
the backlog with no task record, a pane Firstmate calls alive that Herdr does not have → the first mate's own
reconciliation at its next start clears them, and the lines leave.

**A contract that moved.** `/updatefirstmate` fast-forwards the clone: Settings says `Firstmate 9296f9b — moved from
f9f74a1 (/updatefirstmate)` and nothing else changes while the two schemas hold. If a schema moved, the Crew page
says `Crew: unsupported snapshot contract <x>, expected fm-fleet-snapshot.v1 · showing the last reading`.

**A tool goes missing.** Launch is disabled with `tasks-axi isn't installed — run kinas crew setup`, the tool's row in
Settings turns red, and nothing else changes.

**Context for an agent.** `kinas context` prints its Crew section from the mirror when the mirror is under 5 minutes
old (the launch screen too), else from the snapshot as today; and a **Features in progress** section after Projects:
per project, each feature with its first gate that is not approved, or its first unticked slice. *(Clarified at
Gate 2, 2026-09-23: after `## Projects` in `kinas context --agent`; the plain `kinas context` has no Projects
section, so there it comes after the counts.)*

## 4. Surfaces

Every surface composes DESIGN.md §4 components. What DESIGN.md does not yet say is written into it before the code,
as version 1.4 (the list at the end of this section); every binding is written into `keymap.md` first.

- **Sidebar.** Crew gains ⌘3 and Inbox ⌘5 in their tooltips; Inbox shows the waiting count (rule 16). A client
  folder's right-click Menu gains **Add to crew** after Hide from sidebar (Menu, disabled items with their reason).
  The shell's notice line says what went on the clipboard: `Your answer is on the clipboard — paste it into the first
  mate's pane.` after an Inbox action, `The ask is on the clipboard — paste it into the first mate's pane.` after Add
  to crew.
- **Crew page (⌘3).** Title row: "Crew", the **N waiting on you** button (hidden at 0, opens the Inbox), and
  **First mate** — or **Launch the first mate** until it runs. Not installed: the setup line with Copy (EmptyState,
  Button) and the tool table (Table, StatusBadge). Installed, not running: the tool table, the pin line and **Start
  the first mate now?** with Launch, disabled with its one-line reason while a required tool is missing. Running: the
  board — lanes (Lane, Chip) with cards (Card, StatusBadge): title as filed, `ship` or `scout`, the word (rule 20),
  elapsed (`working 12 min`, `done in 41 min`, counted from when Kinas first saw it working, since Firstmate records
  no start), the harness, the PR badge (`PR #123 · checks 3/4 · 1 failing`), **Open its pane** while Herdr has the
  pane. No tasks: `No tasks — ask in the first mate's pane`. The caption `as of 09:31:12`, stale per rule 15; an
  error in one line under the board with `showing the last reading`. Selecting a card opens its detail and marks the
  card selected.
- **Task detail (the right panel).** The panel holds one thing at a time: a task's detail or the reader. Opening a
  card shows the detail; opening the report, the brief or any file shows the reader; × closes the panel. Header:
  the folder's chip and name, the title, the word (PanelHeader). Body (PanelBody): Firstmate's state line verbatim
  (`state: working · source: pane · …`), kind, mode, harness; **The ask** — the title and the first 240 characters of what was
  filed, as Firstmate keeps them — with **Open the brief**; the decision (QuestionCard and the three actions) or
  `No decision pending`; the PR (number, state, mergeable, review) and its checks (ChecksList), or `No PR yet`; the
  timeline (Timeline: state changes, the PR, checks, Firstmate's last events, and orders with the order tag); the
  worktree `present` or `gone`; **Open the report** for a scout, or `Report not written yet`. Footer (PanelFooter):
  **Open its pane**. A task that left the snapshot says `No longer in the fleet snapshot` under its header.
- **Inbox page (⌘5).** Title row "Inbox" with the count. **Decisions**, newest first: InboxItem with the folder's
  chip, the question (Firstmate's summary line verbatim), a quiet line with the task's title, the key and the age
  (`12 min ago`), and Deny / Answer / Approve; A, R and D when an item is focused. An open text box with **Copy and
  go** and one line of hint: `Goes on the clipboard for the first mate's pane · Enter copies, ⇧Enter a new line, Esc
  closes`. After a copy, `Copied 15:02 — paste it into the first mate's pane` under the item, which keeps its actions
  (rule 7). **Held for you**: the same item, its quiet line `Held for you · <title> · <age>`. **Reconcile**: one line
  each, no actions, not counted. Nothing waiting: `Nothing waiting on you.`
- **Home.** Title row: **N waiting on you** (secondary, opens the Inbox, hidden at 0) and **Launch task** (primary,
  goes to the first mate when it runs, else to the Work page as today). **Overnight**: SectionHeader with the
  "since" caption (rule 21), one ProgressRow per shown client folder: chip, name, the latest event and its time,
  the segmented bar, count badges, a chevron; selecting it opens that folder's most important task in the panel —
  waiting on you first, then failed, then the latest; a folder with nothing says `No work overnight in this folder.`
  and opens the folder in the reader, as today. **Waiting on you**: up to three compact InboxItems, newest first,
  Approve inline (it copies and goes to the first mate, as on the Inbox) and Answer or Deny opening the item on the
  Inbox page; `All 5 in Inbox` when there are more. Usage
  and Needs attention are unchanged.
- **Usage.** A **Crew** section last, after This Mac: a MetricRow per harness with a task in flight
  (`claude · 4 in flight`) and one for the queue (`Queued · 1 task`); no bars, no quota. Not rendered when nothing
  is in flight or queued; stale with the page's own rule.
- **Work page.** The chrome (rule 24): `default · firstmate` with the profile `claude`; `default · fm-‹id›` with the
  task's word and its harness; `plain shell`. Copy stays; no Detach.
- **Settings.** Grouped as DESIGN.md §5 says, now that the crew gives the groups something to hold: **Providers**
  (Claude Code, Ollama, Convex, Hostinger), **Crew** (new), **Client folders** (the projects folder, the client
  folders), **Shortcuts** (shortcuts, the global hotkey), **Appearance**, **Advanced** (menu bar, launch at login,
  the organisation, the reader, the CLI). The Crew card: `Firstmate f9f74a1 (pinned)` or `— moved from f9f74a1`;
  `Home: ~/Library/Application Support/ai.sintralabs.kinas/firstmate`; `Backend: herdr`; the tools table (Table,
  StatusBadge: `installed 0.2.5`, `missing`, `below floor`, `gh: signed in`); `Away since 22:10 · back 08:00` while
  Firstmate's away record exists; the projects, one line each, `kinas · no-mistakes · yolo off`, or
  `No projects registered — ask the first mate`. Nothing on the card edits Firstmate.
- **Menu bar.** The title keeps its quota and adds the count: `58% · 2`. The menu's first line, `2 waiting on you`,
  opens Kinas on the Inbox. Refreshed when the crew changes and on the existing minute.
- **CLI.** `kinas crew setup [--dry-run] [--yes]` (the flow above; `--dry-run` prints every step as `would:` and
  touches nothing; the CLI's read-only rule gains this dated exception, which writes only under Kinas's data
  directory, `~/.local/bin` and npm's global prefix). `kinas crew status [--json]` from the store with the app
  closed: installed, pin, tools, counts per word, one line per task with its word, elapsed and PR number — no ids,
  titles, paths or URLs (rule 26). `kinas context`: the Crew section from the mirror, and Features in progress.
- **Keys and the palette** (`keymap.md` first): ⌘3 → Crew, ⌘5 → Inbox, A / R / D on a focused inbox item; the
  palette gains Go to Crew, Go to Inbox and Go to the first mate.

**DESIGN.md 1.4, written with this PRD:** the Lane's header carries counts, not slots; an Inbox item's evidence and
recommendation are shown only when the source carries them, and its keys are bound; four new badge words — **failed**
(solid, `--danger`), **paused** (solid, `--stale`), **unknown** (solid, `--stale`) and **gone** (cross, `--ink-3`);
the right panel holds one thing at a time; Home's "since" on the Mac; the terminal chrome shows a badge only for a
worker's pane; the Work page's strip of lanes does not come with Build 3 (§6). **DESIGN.md 1.7, with the reopening:**
a crew item's actions copy an answer line and go to the first mate, with **Copy and go** in the text box and `Copied
15:02` as the one state after — no Sending, Sent or Not delivered, and no item that cannot be answered from Kinas.

**Screens:**
- `mockups/board.html` — the Crew page: the running board with the detail closed; below it, the page before setup
  and before launch
- `mockups/task-detail.html` — a ship task's detail in the right panel, with a decision, checks and an order
- `mockups/inbox.html` — the Inbox: an open decision, one with its box open, one copied and waiting for Firstmate to
  close it, a held task, reconcile lines
- `mockups/home.html` — Home with the crew's night, Waiting on you and the count
- `mockups/settings-crew.html` — Settings grouped, with the Crew card
- `mockups/work.html` — the Work page's chrome in its three forms, and the client folder's menu with Add to crew
- `mockups/usage-and-menu-bar.html` — Usage's Crew section and the menu bar with the count

## 5. Validation

Each case runs against the fake home in a throwaway Herdr session unless it says otherwise, and every one also passes
the privacy check (AC-10).

- **AC-1 · Setup.** `kinas crew setup --dry-run` prints seven steps with `would:` and creates nothing; `--yes` over
  stub `git`/`npm`/`shasum` leaves the home at `f9f74a1` on `main`, `config/backend` = `herdr`, every tool `ok`, exit
  0; with `tasks-axi` removed, Launch is disabled with `tasks-axi isn't installed — run kinas crew setup` and its row
  in Settings reads `missing`.
- **AC-2 · One first mate.** Launch twice, then with Herdr's server stopped: exactly one `firstmate` workspace, its
  pane's folder the home, its foreground program the stand-in for `claude`; the Work page shows and the terminal has
  the keys; Kinas's terminal pid is unchanged and nothing was typed into it; the second click logs `focused`; with no
  server the sidebar says `Herdr isn't running; attach it first`.
- **AC-3 · A filed task is a card within 5,000 ms**, measured in the page from the backlog's change, with its title
  as filed in the detail.
- **AC-4 · A working task** reads **working**, gets **Open its pane** (which focuses that pane's workspace), then
  `PR #123 · checks 3/4 · 1 failing` and **CI red**, then **ready** — no click needed.
- **AC-5 · A decision goes to the first mate's chat.** Approve on an item keyed `api-shape` of task `<id>`, with the
  first mate running: the clipboard holds exactly `On <id> (api-shape): Approved — go ahead.`; Herdr reports the
  `firstmate` workspace focused, the Work page shows and the terminal has the keys; the stand-in for `claude` received
  no input; no Firstmate script but the snapshot ran (every stub script records its calls); an inventory of the fake
  home (path, size, time) is unchanged; the item reads `Copied`, and the count in the sidebar, on Home, on Crew and in
  the menu bar is unchanged. Once a snapshot without the key arrives, the item leaves and every count drops by one
  within 1 s. Answer with `REST` copies `On <id> (api-shape): REST`.
- **AC-6 · Done and gone.** The card reads **done** with `done in 41 min`; Open its pane leaves; the detail says the
  worktree is `gone`; after a snapshot that omits it, `No longer in the fleet snapshot`, and the row is still in the
  store.
- **AC-7 · Lanes by repository.** Tasks on two projects whose clones' `.git/config` name the GitHub repositories of
  two client folders, one on a project matching none, and one on a project whose clone has no `origin`: two folder
  lanes in the sidebar's order with their chips, then one lane under the repository's name and one under the project's
  folder name, neither with a chip; a `project` path outside `<home>/projects/` is not read; Usage's Crew section
  reads `claude · 2 in flight` and `Queued · 1 task`; with every task done, the section is gone.
- **AC-8 · Orders.** Typed into the worker's pane, `deploy the thing` + Enter is an order on its timeline within
  1,000 ms; `hello` typed into the first mate's pane leaves no row; `token Bearer abc123` is stored as
  `token [redacted]`.
- **AC-9 · A restart lists and repairs nothing.** Two launches over one data directory: the Reconcile group lists
  exactly the two lines for the task with a dead pane and a gone worktree, none for the healthy one; the fake home is
  unchanged; both tasks' rows and timelines survived.
- **AC-10 · Nothing leaks.** After every crew case, the log and `kinas crew status --json` contain no fixture marker,
  and the JSON has no key named `id`, `title`, `path`, `url`, `worktree`, `home`, `key`, `summary` or `text`; the
  app's capabilities are byte-identical to `main`.
- **AC-11 · The fake drives everything.** Every crew case passes without `default` and without starting `claude`
  (the `claude` processes before and after are the same).
- **AC-12 · The first mate not running, or not launchable.** With no `firstmate` workspace, Deny with `not before
  Monday` copies `On <id> (<key>): Denied — not before Monday`, and the launcher creates the workspace and starts the
  stand-in for `claude` with no argument. With `tasks-axi` removed as well, the launch is refused with `tasks-axi
  isn't installed — run kinas crew setup`, the clipboard still holds the line, no workspace is created, and the item
  and the count are unchanged.
- **AC-13 · A moved contract is refused.** Schema `fm-fleet-snapshot.v2`: the error line with `showing the last
  reading`, every card as before; a `state/home-summary.json` that is not JSON changes nothing on screen and adds no
  Reconcile line.
- **AC-14 · Held tasks.** A task held on itself with its worker alive, and one created with `Origin:` whose worker is
  gone: both show the same actions, and Approve copies `On <held id>: Approved — go ahead.` and goes to the first
  mate; no script runs.
- **AC-15 · Home's night.** With fixture events inside and outside the window: the caption reads `since <time>, <n h
  n m>`; a folder's row shows only the in-window tasks in its bar and badges; selecting it opens the waiting task's
  detail; a folder with nothing says `No work overnight in this folder.`; Waiting on you shows three items and
  `All 5 in Inbox`.
- **AC-16 · The pane opens on the first mate.** A `firstmate` workspace exists, unfocused; Kinas starts: Herdr reports
  it focused; over the next 60 s with no click, Kinas focuses nothing else.
- **AC-17 · Add to crew.** First mate stopped: the new workspace's pane runs the stand-in with exactly the sentence of
  rule 3 as one argument. Running: the clipboard holds the sentence, the pane is shown, nothing was typed. A folder
  with no GitHub remote: the item is disabled with `No GitHub remote`. An `origin` with a character outside the
  allowed set: refused, nothing launched.
- **AC-18 · The chrome.** A worker's pane focused: its word and harness; the first mate's: no badge, `claude`; a
  plain shell: `plain shell`.
- **AC-19 · Features in progress.** A fixture project with a status file at Gate 1 in progress is listed with that
  gate; one with every gate approved and every slice ticked is not; a malformed one reads `status unreadable`; the
  log names no feature.
- **AC-20 · Nothing that worked broke.** The full end-to-end suite passes, run alone; every deliberate change to an
  existing test is named in its PR (the palette's order, the command registry, the navigation's tooltips, ⌘3 and ⌘5
  in the key contract, Settings' recorded screens after the regrouping); no test is skipped or loosened.
- **AC-21 · Fast enough.** On the installed release build with the crew running against the real home, the warm open
  of `plan-300.md` has a median under 200 ms over ten opens.
- **AC-22 · It ships clean.** `bun run check` and the full suite green on `main`'s commit; merged by fast-forward;
  the release binary holds none of the test seams; `/Applications/Kinas.app` built from that commit and running;
  `kinas crew status --json` says `installed: true` with the pin.
- **Needs the captain's eyes** (the smoke test): the first launch into his own `default` session, the trust prompt
  answered once, Claude Code's Bypass Permissions prompt at the first real worker (his choice: accept it, or tell the
  first mate to use auto mode, as the probe did), the first real ask and its card, the first real decision answered
  from the Inbox — pasted into the first mate's pane — and the worker going on, Add to crew on a real folder, the
  morning after a night of crew work read from Home.

## 6. Out of scope

- **Panes embedded in the Crew page** — a later spec; it touches the rule that the terminal is never remounted.
- **A tmux fallback** — if the slice-0 probe shows Firstmate's Herdr backend does not work on Herdr 0.9.0, the build
  stops and reports; workers the Work page cannot show are not this product.
- **The crew's share of a quota, and provider slots** — Firstmate publishes neither, and Kinas never runs
  `quota-axi` (rule 9).
- **Evidence and a recommendation on inbox items** — not in Firstmate's contracts; shown the day they are.
- **The Work page's strip of lanes and the review queue above the pane** — the Crew page and the Inbox are those
  lists, and a strip would need a key and a second copy of each; DESIGN.md 1.4 says so.
- **Detach in the terminal chrome.**
- **Editing Firstmate from Kinas** — project modes, the registry, away mode, bootstrap, interrupting, stopping,
  relaunching or tearing down a worker: all asked of the first mate in its pane.
- **Second mates and Relay** — a second mate, if one exists, is one line; nothing more.
- **Launching the first mate from the CLI, and a command channel from the CLI to the app** — the Crew page launches;
  every change is asked of the first mate in its pane.
- **Answering the crew anywhere but the first mate's chat** — Firstmate takes a captain's call only there (slice 0's
  probe); if it ever publishes a channel for the captain's answers, a record superseding ADR 0016 can use it.
- **Writing `AGENTS.md` or anything else into a client folder** — the desk is the captain's; conventions reach the
  crew through the projects' own files, which the captain or the first mate writes.
- **The first mate on any harness but Claude Code; Orca instead of treehouse.**
- **The phone, ⌘N and the launch form** — later builds.
- **Splitting Kinas's own token counts between the captain and the crew.**

## 7. Open questions

None open. Slice 0 answered the six it was given (below, 2026-09-23, after slice 0), and Gate 2 settled the brief:
**Open the brief** opens Firstmate's documented `data/<id>/brief.md` on a click, and nothing parses it.

### Asked and answered

*2026-09-22, the first draft's ten questions:* the pin is `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540`, reviewed monthly
· no tmux fallback; a failed probe stops the build · treehouse · `quota-axi` installed for Firstmate, never run by
Kinas · no decision file: answers run `fm-send.sh --resolve-key` *(replaced after slice 0: answers go to the first
mate's chat)* · the snapshot `fm-fleet-snapshot.v1` and the home summary are the contracts · the captain's orders are
recorded by Kinas in its own store only · away mode is Firstmate's, entered in the pane, displayed by Kinas ·
`data/projects.md` is displayed, not edited · the order: probe, mirror, installer and launcher, board, inbox and
orders, reconciliation and settings; embedded panes later.

*2026-09-23, after the review:*
1. Where does the inbox live? **A — its own page**, with the sidebar count and Home's button; Crew keeps the board and
   the task detail.
2. A held task with no live worker? **A — shown in the Inbox with "Answer in the first mate's pane"**; ADR 0014
   stands. *(Replaced after slice 0, below: every item is answered in the first mate's chat.)*
3. Does Build 3 fill Home? **A — yes**: Overnight, Waiting on you and the waiting count.
4. Which Firstmate? **A — stay at `f9f74a1`**; the fleet ledger is read in slice 0.
5. The plan's additions — the first-run ask, Add to crew, the Work pane opening on the first mate, the count in the
   menu bar, in-progress features in `kinas context`: **all inside Build 3.**

*2026-09-23, at Gate 2:* the captain approved three clarifications the architecture read found — rule 8 lists the
scout report's first line in `kinas context`; rule 22's "when Kinas starts" is Herdr answering within 10 s; Features
in progress sits after the counts in the plain `kinas context`. Each is marked where it applies.

*2026-09-23, after slice 0 — the probe's answers* (a real first mate and two workers in a throwaway Herdr session;
`build-spec.md` §17):
1. Firstmate's Herdr backend works on Herdr 0.9.0: two workers spawned, tracked, finished and torn down, all in the
   probe's session and none in `default`. The build goes on.
2. `claude '<the sentence>'` starts Firstmate's session and takes the sentence as the first ask; rule 3 stands.
3. The snapshot names no GitHub repository — a task's `project` is Firstmate's own clone — so rule 18 reads the
   clone's `origin` (the captain's answer 2 below).
4. A held task is either held on itself (its worker is the task) or names its worker in an `Origin:` line; with the
   Inbox answering in the first mate's chat, no answer depends on it any more.
5. The fleet ledger (`state/fleet-ledger.jsonl`, on Firstmate's `main` after the pin) would give a real dispatch time
   and merge and teardown times; worth adopting at the next monthly pin review, after this build ships. The pin does
   not move in Build 3.
6. The snapshot takes 0.14–1.05 s; rule 13's cadence stands.

*2026-09-23, after slice 0 — the captain's three answers,* on what the probe found:
1. How does the Inbox answer? **A — in the first mate's chat.** Approving a held landing through `fm-send.sh` closed
   the hold while nothing landed, and the first mate refused the approval as not coming from its chat. Approve,
   Answer and Deny put a line on the clipboard and go to the first mate; the captain pastes it. Kinas runs no
   Firstmate script that changes anything (rules 5–7; ADR 0016 supersedes 0014, ADR 0017 supersedes 0015). This
   replaces answer 2A of the same morning: every held task is answered in the pane now, not only one whose worker has
   gone.
2. How does a crew project match a client folder? **A — by the `origin` in the project clone's `.git/config`,** one
   small read under the home, added to rule 8 (rule 18).
3. The Reconcile line for an invalid home summary? **A — dropped.** The summary goes invalid during normal running;
   its modification time stays a trigger, and its contents are not read (rule 8).
