# Kinas so far — an overview for someone new

Written 2026-09-22, after the eighth piece of work shipped. It says what Kinas is, what has been built, in what
order, under which rules, and how work gets done here. It is a map; the detail lives in the documents listed at
the end.

## 1. What Kinas is

Kinas is a Mac app, with a `kinas` command-line tool inside it, built by Sintra Labs for one developer — Miguel —
whose working day is spent driving AI coding agents (Claude Code, Pi) inside Herdr, a terminal multiplexer. Before
Kinas, that day ran across three windows: a terminal (Ghostty), browser tabs to see how much of each AI plan was
left, and an editor (Cursor) to read the markdown that agents write. Kinas replaces all three with one window.

Everything runs on the Mac. There is no server, no login, no SSH, and Kinas makes no API calls of its own: it reads
the plans you already pay for and the files already on disk. State is one SQLite file.

The long-term design (`~/Documents/Projects/SintraLabs/kinas-architecture.md`, v3.0, frozen) is bigger: an
operations OS for a company run on agents, with a cloud control plane, a run feed, approvals on a phone and a
deployer. The Mac app is being built first, locally, "as a castle": it decides the contracts (the store's tables,
the key bindings, the command registry) and everything inside is a seam a later build can fill — SQLite now where
Convex may go later, xterm.js now where another terminal engine may go. Tables already carry the reference names and
an `org_id`, so that move is a migration, not a redesign. The rule since day one: grow in tested increments, an empty
castle first, then one room at a time.

## 2. The shape of the code

| Piece | Where | What it is |
|---|---|---|
| Rust core | `app/src-tauri/src/` | Tauri 2 app: the SQLite store (one writer), the PTY that runs the terminal, the readers that fetch usage, the menu-bar item, the reader's file access and Unix socket, every command the webview may call |
| Webview | `app/src/` | React 19 + Vite, plain global CSS. The window: sidebar, pages, the reader panel, the palette, the terminal (xterm.js) |
| CLI | `cli/src/` | `kinas`, compiled with Bun into one binary shipped inside the app bundle and linked at `~/.local/bin/kinas` |
| Shared packages | `packages/store`, `packages/commands`, `packages/context` | Staleness rules and the read-only SQLite adapter; the command registry the CLI and the palette both use; the context packet |
| Migrations | `migrations/` | Forward-only SQL, applied by the app (schema version 4) |
| Tests | `e2e/`, `*.test.ts`, `#[cfg(test)]` | WebdriverIO end-to-end specs against the debug app; Bun unit tests; Rust unit tests |
| Docs | `README.md`, `keymap.md`, `docs/smoke-test.md`, `tasks/` | The README is the user manual; `keymap.md` is the law on keys; the smoke test is the checklist of what is proven and how; `tasks/` (git-ignored) holds every PRD, task list and build spec |

Versions are pinned exactly (no `^`), and a new dependency needs a reason. Tauri 2.11, React 19, Bun 1.4.2, Rust
stable. Tools the terminal expects on the Mac: `herdr`, `pi`, `lazygit`, `claude`.

## 3. A tour of the app today

**The window** has three columns. On the left a 220 px sidebar: the wordmark, the seven rows (Home, Work, Crew, Inbox,
Usage, Reader, Settings), the client folders — every git repository under the projects folder, each with its colour
chip — then Pinned, the open folder's Files, Recent, and at the foot the VPS connection; ⌘S hides it. In the middle, the page. On the right, when something
is open, the reader panel, with a draggable divider whose width is remembered. Every page stays mounted; only
visibility changes, so the terminal is never restarted by navigation.

**Home** (⌘1, the landing page since 2026-09-23) answers what needs you: Overnight lists every client folder (internal
ones last, tagged) and, until the crew arrives, says no work ran in it; Waiting on you says nothing waits; Usage shows
the three readings that decide the day and Needs attention — every reading past 80 % used, stale or dead, and this
Mac's memory or disk filling up. Launch task goes to the Work page with the terminal holding the keys.
(Amended 2026-09-25: with the crew, Overnight's caption says since when — the end of the last session, from the
window's focus — and each folder's row counts its tasks with activity since then; Waiting on you shows the newest
three things the first mate asks, with Approve inline.)

**Crew** (⌘3, since 2026-09-24) is the first mate's fleet. The first mate is Firstmate
(`github.com/kunchenguid/firstmate`) running on Claude Code in a `firstmate` workspace of Herdr's `default` session;
Kinas keeps its own clone at a pinned commit in the data folder, installed by `kinas crew setup`, and adopts it rather
than rebuilding it (ADR 0016): it runs only Firstmate's three read-only scripts and writes nothing under its home. A
thread mirrors `fm-fleet-snapshot.sh --json` into the store at most every 5 s. The page is a board with one lane per
repository — a client folder's under its name — and a card per task with its state, PR and checks; a card opens the
task's detail in the right panel, and a worker's card opens its pane. Launch the first mate starts it in its pane.

**Inbox** (⌘5, since 2026-09-25) lists what waits on you: each decision the first mate asks and each task it holds.
Kinas never types into a pane (ADRs 0003, 0017): **A** puts `On <task> (<key>): Approved — go ahead.` on the
clipboard and goes to the first mate's pane for you to paste and send; **R** and **D** open a box first. One count
of what waits shows on the sidebar, Home, the Crew page and the menu bar (`58% · 2`). A Reconcile group lists, for
information only, where Firstmate's records and what Kinas sees disagree. A client folder's right-click menu has
**Add to crew**, which hands its GitHub repository to the first mate in one fixed sentence.

**Usage** (⌘4) shows what each plan and this machine are doing — a hero row of Claude's week and session and Ollama's
session, then one section per provider with a single "as of" caption:

- *Claude plan* — session and week, read from Claude Code's own status line through three lines Miguel adds to
  his status-line script. Kinas never reads Claude's login and never calls Anthropic.
- *Ollama Cloud* — session and week from `ollama.com/api/usage`, with the API key kept in the macOS Keychain.
- *Convex* — nine usage metrics against the plan's limits, read with a deploy key that can only view usage.
- *Hostinger VPS* — bandwidth, CPU, RAM, disk, uptime and power state of one machine, read with a token that
  could do far more, so "read only" is enforced by our code and a test that greps for anything but GET.
- *Model usage by day* — tokens per provider over the last 30 days, counted from the Claude Code and Pi transcripts
  on disk, each message once; the models in the tooltip and in the Today and Month to date tables below.
- *This Mac* — CPU, memory and disk, with disk shown the way Finder shows it.

Each section says once when its numbers are from and, on hover, where they came from; only a stale reading says so
where it is. A failed read never overwrites a good value; a reading that is too old is shown as stale, and older
still as dead. Percent used everywhere; a bar turns amber past 80 % used and red past 95 %.

**Work** (⌘2) is one terminal pane under a slim chrome naming its session, with a Copy button. It starts on the Kinas launch screen (identity, projects, crew, sessions,
quotas, recent activity); Enter attaches Herdr's `default` session, `q` leaves a plain shell. Every keystroke
without ⌘ goes to the terminal — Tab, Esc, ⌃-anything — so TUIs like Herdr, Pi, vim and lazygit work as they do in
a real terminal. Selecting text copies it to the clipboard (inside Herdr too, through OSC 52); nothing in the pane
can ever read the clipboard. At a plain prompt, ⌫ over a selection removes exactly that text.

**The reader** opens on the right when you run `kinas open <file or folder>` from any shell, or click a file in the
sidebar. Markdown renders in the house style with Mermaid diagrams, a frontmatter card, a Contents list and working
relative links; any other text file shows as highlighted source with line numbers; images show; an `.html` file
renders as the page it is, in a sandbox that may run its own scripts but can reach neither the network nor the
app. The reader follows the file as it changes (agents save by rename; the watch is on the folder). Its header has
a Rendered/Source toggle, Copy, a ▾ menu (Download a copy through the macOS save sheet, Print as PDF through the
print sheet, Open in editor in a new Herdr pane, Pin), Expand and Close. It only reads: the one thing it ever
writes is the copy you asked for, where you chose.

**The sidebar's lists.** Pinned files and folders survive a relaunch (the only thing about what you read that is
ever stored, and only by your click). Recent lists what was opened this session and forgets it on quit. A folder's
row — in a tree, in Recent, in Pinned — shows, when pointed at, a pin button and a terminal button; the terminal
button asks Herdr for that folder's workspace (one per folder, found again on the next click) and takes you to the
Work page. Nothing is ever typed into the terminal on your behalf.

**Settings** (⌘,) is a page of cards: the Claude hook lines with Copy buttons and whether the hook is arriving; the Ollama,
Convex and Hostinger credentials (write-only fields; keys live in the Keychain); rebindable shortcuts; the global
hotkey; which quota the menu bar shows; launch at login; the organisation name; the projects folder `kinas open`
searches; each client folder's colour and whether it is internal; the editor Open in editor runs; the theme and the
accent (Settings → Appearance); and the state of the `~/.local/bin/kinas` link.

**How it looks** is `DESIGN.md`: warm neutrals, one accent, colour only for meaning, the type scale carrying the
hierarchy. Every surface is built from `app/src/ui/` on the tokens in `app/src/styles/tokens.css`; a debug build
opened with `#stories` shows every component in every state, and `docs/design/screens/` holds Home, Usage and
Settings in both themes.

**Everywhere else.** ⌘K opens a command palette (status, refresh, go to a page, sidebar, settings); ⌘⇧Space brings
Kinas forward from any app. The menu-bar item shows one quota (`58%`, `58%?` when stale, `—` when dead) and lists
them all. Closing the window hides it; the app, the readers and the terminal keep running.

**The CLI.** `kinas` (the launch screen), `kinas status [--json]` (the Usage page as text, works with the app
closed), `kinas context [--agent] [--cwd <dir>] [--refresh]` (the context packet: projects, artifacts,
conventions, crew, sessions, decisions, quotas, recent — for a person, or as markdown for an agent), and
`kinas open`. Session-start hooks in `integrations/` put the packet in front of every new Pi and Claude Code
session. (Amended 2026-09-25: `kinas crew setup` and `kinas crew status [--json]`; the packet gains Features in
progress — each project's `tasks/<feature>/status.md`, reduced to its next gate or slice — and reads the crew from the
app's mirror while it is fresh.)

## 4. How it got here — the builds, in order

Every piece of work follows the same path: a PRD in `tasks/` with its questions answered first, a task list, an
agent build spec that pre-decides every fork, then the build, then a hand-off with every acceptance criterion and
its evidence. The dates are 2026.

| # | Work | Landed | What it added |
|---|---|---|---|
| 1 | **Build 1 — the empty app** | 09-14 → 09-15 | The Tauri app, the store, the Usage page (Claude, Ollama, transcripts, This Mac), the Work page's terminal on a Rust PTY, the palette, the global hotkey, the menu bar, `kinas status`, Settings, `keymap.md`, the smoke test, the e2e harness. AC-1 to AC-12 pass; 30/30 e2e |
| 2 | **Selection and clipboard** | 09-15, PR #5 | Copy on select inside and outside Herdr (OSC 52 handled), one native write path, never a read; ⌫ over a one-row selection at a plain prompt; the copy toast (PR #7) |
| 3 | **CLI v0** | 09-15 | The context packet and its cache, the launch screen with the logo, `kinas context`, the session hooks; the Work pane starts on the launch screen; Settings becomes a page; ⌘S |
| 4 | **`kinas open` and the reader** (Build 2) | 09-15 → 09-16, PRs #9–#12 | The Unix socket, the path rules, markdown in house style, live reload, Open in editor, the folder tree, the confirmation card for a path outside the projects folder, the draggable divider, the projects-folder setting and open-by-name. AC-1 to AC-9 pass; warm open median 39 ms |
| 5 | **The reader opens any file** | 09-16 → 09-17, PR #15 | Text judged by bytes not extension, highlighted source with line numbers, images, the sandboxed HTML preview proved against a real listener (14 URLs aimed, 0 requests). AC-1 to AC-8 pass; median 27 ms |
| 6 | **Convex usage** | 09-17 | The first external provider: watch-only by the credential's own scope, one GET, nine metrics, a new `provider_metrics` table, the month gauge labelled as an upper bound |
| 7 | **Hostinger VPS usage** | 09-18 | The second provider: watch-only by our code, two GETs per poll, denominators from the API, bytes vs MiB pinned, a tile not a gauge for machine state |
| 8 | **The three-column shell** | 09-18, PRs #19–#20 | The reader leaves the Work page for a panel on the right of the whole window; the header (toggle, Copy, ▾ menu, Expand, Close); Download through the save sheet with the webview given no new power; Print as PDF proved on the real engine; the 220 px sidebar with the file tree in it; Pinned and Recent. AC-1 to AC-16 pass; 15 specs / 86 e2e cases |
| 9 | **Folders in the sidebar** | 09-21, PR #21 | Pin a folder from any row, folders in Recent, Open in the terminal through Herdr's CLI (one workspace per folder, reused), a notice line in the sidebar while the panel is closed. 16 specs / 92 e2e cases; median 55 ms |

Since this table was written (amended 2026-09-25), the design system, folder views, tree changes and the reader's
layout have shipped too, and **Build 3 — the first mate** (09-22 → 09-25): Firstmate adopted after the slice-0 probe
showed it already does the conductor's job, then nine slices — the collector and the Crew page, `kinas crew setup`,
the launcher, lanes by repository with PRs and checks, the Inbox and the one count, the order log, Home's night, Add
to crew, and reconcile with the context packet. The first ship point was PR #38 on 09-24; the rest ships together.

Two things were parked on purpose along the way: inlining an HTML preview's local assets (specified, then set aside
on 09-16 — the preview says how many assets did not load instead), and showing Convex in the menu bar (every
quota-shaped surface needs a percentage and a reset time, which Convex cannot give).

## 5. The rules everything obeys

These are the invariants the specs state and the tests enforce. A newcomer should know them before touching code,
because most of them exist because something went wrong once.

**Secrets and privacy**
- No plaintext secret anywhere: API keys live in the macOS Keychain, written through `security` on stdin so `ps`
  never sees them; `Bearer …` and `sk-ant-…` are redacted before any error is stored or logged.
- Kinas never reads Claude Code's login, never calls Anthropic, never writes under `~/.claude`.
- No file's contents and no file's path ever reach the log or `kinas status --json`. The log holds durations, counts
  and byte totals. The one stored path is a pin, by explicit click.
- Providers are watch-only: Convex and Hostinger get GET requests only, and tests grep the code to prove it.

**The crew** (since 2026-09-24)
- Kinas writes nothing under Firstmate's home but `config/backend`, through `kinas crew setup`, and runs none of its
  scripts that change anything — `fm-send.sh` above all. Guard tests grep the code for both, with negative controls.
- Kinas's words reach the first mate only as one fixed launch sentence or on the clipboard for the captain to paste;
  it never types into a pane, and never runs `quota-axi` or reads under `~/.claude`.
- Nothing about a task — id, title, path, URL, key, answer — reaches the log or `kinas crew status --json`.
- A snapshot contract that moves at the pin is refused, and the last reading stays.

**The store**
- One writer, the app; the CLI opens read-only. Migrations are forward-only. Every table carries `org_id`.
- A failed read never overwrites a good value: "a gauge that falls to 0 % on an error reads as the whole plan being
  left — the most dangerous wrong answer this page can give."
- The store's mutex is not re-entrant: never take `Store::conn()` while holding it. It froze the window once.

**The terminal**
- Every keystroke without ⌘ goes to the PTY. A binding is written in `keymap.md` before the code that registers it.
- The terminal is never remounted: nothing above `<Terminal>` in the React tree is conditionally rendered, wrapped or
  re-keyed, because a remount restarts the PTY and drops Herdr's client. Tests assert the PTY's pid across every
  shell action.
- Kinas never types into its own terminal. Open in editor and Open in the terminal ask Herdr through its CLI with a
  fixed argv, because when Claude Code or Pi has the pane, typed text arrives as a prompt.
- Nothing in the pane can read the clipboard.

**The reader**
- Every command re-checks its path, every time: canonical, inside the projects folder or explicitly allowed by a
  click. The socket accepts any local process, so nothing is trusted because the CLI checked it.
- Nothing in a file can run code in the app or reach the network. Markdown HTML is off; the preview frame is
  `sandbox="allow-scripts"` and never same-origin; the injected CSP names every fetch directive; no `postMessage`
  listener exists in a release build.
- No disk read on the main thread, and the socket never waits for it.
- Rust decides how a file renders and words every refusal; the webview shows Rust's words.

**How it looks** (the design system, 2026-09-22/23)
- `DESIGN.md` is the law; `tokens.css` is its one implementation, and tests hold DESIGN.md §2, `design/preview.html`
  and the mockup template equal to it. A component or a state is written into DESIGN.md §4 before the code.
- No raw colour, font size or spacing outside `tokens.css` (the guard test; one sheet, `reader.css`, still on a
  ratchet that may only fall); no background transition — WKWebView freezes one across the theme change.
- The four colour roles never mix: neutrals measure, the accent means interactive or selected, status means state,
  category means identity. Every text pair is measured at its contrast floor in both themes and at every accent.
- Pages compose `app/src/ui/` and add layout only. Theme and accent are CSS variables, so neither touches the PTY.

**The repository**
- It is public. No client names, no private paths: `scripts/private-names` (git-ignored) lists what must never
  appear, and a check runs against every added line and commit message. `tasks/` is git-ignored except the
  templates and each feature's status file, PRD and mockups (since 2026-09-22; `scripts/gitignore.test.ts` pins it).
- Dependencies are pinned with `=`; no existing pin moves without a reason. `capabilities/` (what the webview may
  call) changes only deliberately.
- Test hooks and debug seams are `#[cfg(debug_assertions)]`; `strings` on a release binary must find no `wdio` and
  no `__kinasTest`.
- A failing test is never disabled, skipped or loosened to reach green.

## 6. How work is done

**Documents first, through four gates.** Since 2026-09-22 every feature runs the software-factory workflow
(`AGENTS.md`, the rule book; the skill it comes from is vendored at `.claude/skills/software-factory/SKILL.md`):
Gate 1 Product — the PRD (`tasks/<feature>/prd.md`, with its open questions asked before a line is written, an
announcement paragraph and a screens line) and one plain HTML mockup per screen under `tasks/<feature>/mockups/`,
styled with `DESIGN.md`'s tokens and reviewed inside Kinas with `kinas open`; Gate 2 Architecture
(`architecture.md`, when more than one layer is touched); Gate 3 Program design — the build spec's §11: every file,
the types and signatures with no bodies, the call stacks, the test plan, the least confident decisions; Gate 4 the
slice plan (§12), then one vertical slice at a time, the first a tracer bullet. Each gate is approved in so many words
("Approve Gate N, or what should change?") and recorded in `tasks/<feature>/status.md`, which a fresh session reads
first and continues from. At every gate and slice boundary the documents hold everything decided and the agent says
so in one line — a safe point for a fresh session. Trivial changes skip the gates. The templates are in
`tasks/_templates/`; only the status file, the PRD and the mockups are tracked — the build spec and the architecture
document stay on this Mac. The docs that a change makes false — `keymap.md`, the README, the smoke test, older
specs — are amended before the code, with dated notes, never by rewriting history. A decision that outlives its
feature becomes a record in `docs/adr/` (never rewritten; superseded by number, and a test holds every decision's
hash); anything outside the repository an agent needs to know about gets a page in `docs/external/`, names only.

**Branches.** Work happens in a git worktree under `.claude/worktrees/`, on a `feat/…` branch. Nothing is pulled,
stashed or committed in the main checkout while a worktree exists. The branch is pushed, a PR opened, and `main`
fast-forwarded to it — no merge commits, never a force-push.

**Checks.** `bun run check` runs the typecheck, the Bun tests, the CLI compile, the Rust tests and clippy with
warnings as errors. `bun run e2e` builds the debug app and runs the WebdriverIO specs; it must run alone on the
Mac — a cargo build or a second session's test app beside it fails unrelated specs, and each element lookup costs
about five seconds, so specs read the page in one script rather than element by element. Tests never touch Herdr's
`default` session; they create and delete throwaway sessions.

**Shipping.** A release build (`bun run build`), the `strings` check, an ad-hoc signature, and a copy to
`/Applications` while the previous bundle is kept aside until the gate passes: the median warm open of a 300-line
markdown file must stay under 200 ms, measured from the app's own log by counting lines. Then the worktree and
branch are removed and the hand-off written into the spec.

**What only Miguel can check** is listed in `docs/smoke-test.md` as `outstanding — needs Miguel`: anything that
needs eyes on the screen, a physical keyboard or mouse, a native macOS sheet, or his own Herdr session.

## 7. Where things stand (2026-09-23)

- The design-system build (`feat/design-system`, worktree `.claude/worktrees/design-system`): slices 0–6 and slice
  7's documents are committed on the branch, not pushed; 551 Bun tests, 181 Rust tests, 20 e2e specs. Ship points 1
  and 2 are green and waiting for the captain's word to push; ship point 3 closes the build. The earlier notes below
  are as of 2026-09-22.


- `main` is at `85d8efc` (PR #23, the process half-day — documents and two tests, nothing under `app/`); `/Applications/Kinas.app` is built from `592fcce`, the last commit that changed the app, signed, running. The main checkout is behind `main` until `feat/light-theme`'s worktree is gone; then `rm DESIGN.md kinas-design-preview.html && git pull --ff-only`.
- 398 Bun tests, 170 Rust tests, 16 e2e specs with 92 cases. The last full e2e run had one case fail while another
  session's test app was open; it passed on rerun, but there has been no clean full run since PR #21.
- Median warm open on the installed app: 55 ms.
- Another branch, `feat/light-theme`, is in progress in its own worktree and will meet the sidebar work in
  `shell.css`, `Sidebar.tsx` and `App.tsx`.

**Open, for Miguel:** the save and print sheets on the installed app; Open in editor and Open in the terminal in
his own `default` session; the folder-name shortening under the pointer; three `curl` probes with his Hostinger
token to settle how bandwidth is summed (until then bandwidth is a figure, not a gauge); `README.md:12` against the
private-names list; the seven-workday "no other terminal opened" clock from Build 1.

**Parked, on purpose:** a Codex gauge (Codex is not installed); quota history; costs and spend; a second occupant
for the right panel; a second terminal, splits or tabs; persisted Recent; keyboard shortcuts for the reader's
controls; asset inlining in the HTML preview; a Vercel provider; memoising the three always-mounted pages.

## 8. Reading list

| Read | For |
|---|---|
| `README.md` | Setup, every command, the CLI, config, environment variables, layout |
| `AGENTS.md` | How agents work here: the four gates, the resume rule, the approval protocol, where a feature's documents live |
| `DESIGN.md` | The design system — tokens, components, pages, writing — the law for every surface; `design/preview.html` renders it |
| `keymap.md` | Every key binding on every surface, and why the ones that are click-only are click-only |
| `docs/adr/` | The fourteen decisions behind §5, each with its incident, its decision and the line that enforces it |
| `docs/external/` | The world outside the repository: Firstmate's home, the Keychain, each provider's credential and scope, the Claude hook, the CLI link, Herdr's `default` session |
| `tasks/_templates/` | The status file, PRD, architecture, build spec (with §11 program design), mockup and ADR templates |
| `tasks/first-mate/status.md` | Where Build 3 stands, gate by gate — read first before touching the first mate |
| `docs/smoke-test.md` | What is proven, by which test, and what still needs a person |
| `tasks/prd-kinas-build-1.md`, `tasks/kinas-build-1-build-spec.md` | The founding decisions: the store, the readers, the keyboard contract, the PTY |
| `tasks/prd-selection-clipboard.md` | Why copy and ⌫ work the way they do in the pane |
| `tasks/prd-kinas-open.md`, `tasks/kinas-open-build-spec.md` | The reader's access rules, the socket, live reload, Open in editor |
| `tasks/prd-reader-any-file.md`, `tasks/reader-any-file-build-spec.md` | Text by bytes, highlighting, the sandboxed preview and its proof |
| `tasks/prd-convex-usage.md`, `tasks/prd-hostinger-usage.md` | The two provider integrations and what "watch-only" means for each |
| `tasks/three-column-shell-build-spec.md` | The shell, the header, Download, Print, Pinned, Recent — and the invariants about never remounting the terminal |
| `tasks/plan-sidebar-folders.md`, `tasks/sidebar-folders-handoff.md` | Folders in the sidebar and Open in the terminal |
| `~/Documents/Projects/SintraLabs/kinas-architecture.md` | Where all of this is heading |
