# Kinas
<img width="2288" height="1160" alt="SL" src="https://github.com/user-attachments/assets/94271395-da35-4f67-ae6f-eb9d96e91752" />

The operating system for a company that runs on AI agents. Local first, one person first.

Kinas is a Mac app with the kinas CLI inside it. It gives one developer a single place to work: a Home page that says what happened overnight and what needs you, a terminal pane with Herdr and the crew, a usage page that shows what every provider subscription and this machine are doing, and, as the agents move in, the run feed, the approvals that reach your phone, and the deployer that ships client changes with rollback.

Everything runs on your Mac. No server, no SSH, no API bill from Kinas: bring your own subscriptions (Claude Code, Codex, Ollama Cloud, or any provider the harness speaks) and Kinas reads their real usage windows locally.

Kinas is built as a castle: it decides the contracts, the doors, the gates, and the record. Everything inside is a seam you fill with your own tools: the harness, the store, the session runtime, the build conductor, the review loop, the channel, the providers. Defaults are shipped for every seam and none is required (`docs/adr/0013-v1-is-local-seams-swap.md`).

Built by Sintra Labs to run Miraside, its first customer. Grown in tested increments: an empty castle first, then one room at a time.

## Setup

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y   # Rust stable
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"                  # Bun 1.4.2
bun install
```

Tools the terminal expects, already on this Mac: `herdr`, `pi`, `lazygit`, `claude`.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Run the app in development (Vite + `tauri dev`) |
| `bun run build` | Build `app/src-tauri/target/release/bundle/macos/Kinas.app` (unsigned, arm64) |
| `bun run check` | Typecheck, Bun tests, compile the CLI, Rust tests, clippy `-D warnings` |
| `bun run e2e` | Build the debug app with the embedded WebDriver, then run every spec in `e2e/specs` |
| `bun e2e/run.ts <name>` | Only specs whose file name contains `<name>`; `KINAS_E2E_SKIP_BUILD=1` reuses the last build |
| `bun scripts/check-usage.ts` | Recount tokens from the transcripts and compare with the store (AC-5) |
| `python3 scripts/logo.py [logo.png]` | Rebuild the app icon source and the CLI's braille logo from `app/src-tauri/icons/source/kinas-logo.png` (then `tauri icon`, as its header says) |

### Install

```sh
bun run build
cp -R app/src-tauri/target/release/bundle/macos/Kinas.app /Applications/
open /Applications/Kinas.app
```

On launch the app links `~/.local/bin/kinas` to the CLI inside the bundle (never replacing a file or link that
is not Kinas's), turns on launch at login, and registers the global hotkey ⌘⇧Space.

## The kinas CLI

| Command | What it does |
|---|---|
| `kinas` | The launch screen: identity on the left; projects, crew, sessions, decisions, quotas and recent activity on the right. Drawn from the cached packet (about 0.1 s), refreshed in the background. On a terminal it holds until Enter or q |
| `kinas context` | The counts, what is waiting on you, and what changed recently |
| `kinas context --agent` | The whole context packet as markdown: `# Kinas context`, `## Projects`, `## Artifacts`, `## Conventions`, `## Crew`, `## Sessions`, `## Decisions`, `## Quotas`, `## Recent` — rarely-changing sections first |
| `kinas context --agent --cwd <dir>` | The same, or nothing when `<dir>` is outside the projects root (for session hooks) |
| `kinas context --refresh` | Recompute the cached packet; prints nothing |
| `kinas status [--json]` | The Usage page as text or JSON |
| `kinas crew setup [--dry-run] [--yes]` | Install the crew (added 2026-09-24, the first mate): checks the prerequisites and `gh auth status`, clones Firstmate at its pin into the data directory, sets its backend to `herdr`, installs each tool at its pinned version — asking y/N before each step — and prints the `setup hooks` lines for you to run. `--dry-run` says what it would do and touches nothing; `--yes` answers yes. Exit 0 when every required tool is installed and `gh` is signed in, 1 otherwise, 64 when stdin is not a terminal and `--yes` is absent |
| `kinas crew status [--json]` | The crew as the app last mirrored it (added 2026-09-24): the pin, the tools, counts by word and what waits on you — never a task's id, title, repository or path. Exit 2 and 3 as `kinas status` |
| `kinas open [<name or path>] [--anywhere] [--launch]` | Open any file whose content reads as text — `.md` and `.mdx` render as markdown, images as images, `.html` renders as the page it is — in an isolated frame that runs its own inline scripts but reaches no network — each with a click-only Rendered / Source toggle, and everything else as highlighted source with line numbers — or a folder, in the reader, the panel on the right of the window beside whichever page is showing, from any folder: an argument is tried as a path where you are, then under the projects folder, then searched for by name under it (`kinas open reader.md`, `reader`, `0008_funnel_stage.sql`, or `Dockerfile`). Several matches list a picker in the reader and open nothing until you click one; no path reopens the last file. The projects folder comes from `KINAS_ROOT`, else Settings → Projects folder, else `~/.config/kinas/config.json`. Paths outside it are refused unless `--anywhere`, which asks for a click. Prints the resolved path, or every match. In the reader's header: Copy the file's text, and under ▾ download a copy through the macOS save sheet, print to PDF through the print sheet, open it in an editor pane, or pin it to the sidebar — a folder opened this way lists there, and pins survive a relaunch while the reader's tabs do not. Every file the reader shows this session has a tab above its header — at most fifteen, in the order first opened, switched with a click, closed with × or a middle-click, dragged to reorder, and gone when Kinas quits; the header's × hides the panel and keeps them. Folders are first-class in the sidebar: a folder's row — in a file tree, in Pinned, among the client folders, or the Files header — shows a pin button and a terminal button when pointed at. The terminal button asks Herdr for that folder's workspace and takes you to the Work page: one workspace per folder, labelled with its path under the projects folder, and a second click focuses it rather than making another (rename it in Herdr, or change the projects folder, and the next click makes a new one). Nothing is typed into the pane. Exit 0 (opened, asked, or Kinas not running: the path is printed), 1, 64 usage, 65 not a text file (binary content, or not a regular file), 66 no such file or nothing to reopen, 77 outside the folder |

Only the launch screen reads keys (Enter, q, Ctrl+C; see `keymap.md`); it ignores Tab and everything else, and every
other command prints and exits. Amended 2026-09-24 (the first mate): `kinas crew setup` also reads the keyboard — one
line per y/N question, on a terminal only.

Where each section comes from — every source is read-only, and one that cannot be read becomes one line:

| Section | Source |
|---|---|
| Projects | Every git repository up to three levels under the root, through plumbing (`symbolic-ref`, `diff-index`, `ls-files`, `hash-object`, `rev-list`) with optional locks off |
| Artifacts | `AGENTS.md`, `README.md`, `docs/`, `plans/`, `specs/`, `con-*`, `spec-*`, `plan-*`, `epic-*` markdown: path, title, modified time |
| Conventions | `AGENTS.md` and every `con-*.md` under the hub, in full |
| Crew | Firstmate's `bin/fm-fleet-snapshot.sh --json` (contract `fm-fleet-snapshot.v1`), background only, 20 s deadline |
| Sessions | Herdr's socket, `session.snapshot`, 1 s deadline |
| Quotas | Claude and Ollama from the app's store; Codex from its session logs. Older than 15 minutes is stale |
| Recent | Commits, crew state changes, briefs filed and artifacts written, kept in the CLI cache |

**Config.** `~/.config/kinas/config.json` (or `KINAS_CONFIG`); every key is optional:

```json
{ "org": "SintraLabs", "instance": "operations", "root": "~/Documents/Projects/SintraLabs", "hub": ".",
  "firstmate_home": "~/firstmate", "herdr_socket": "~/.config/herdr/herdr.sock", "codex_home": "~/.codex",
  "harness": "claude", "model": "opus" }
```

`hub` is relative to `root`. Without `harness`, the launch screen shows the agent most live Herdr sessions run.

**Cache.** `kinas-cli.sqlite` beside the store holds the last packet and the activity log (`packet_cache`,
`activity_log`, migrations in `packages/context/migrations/`). The store keeps one writer, the app.

**Session hooks.** `integrations/` has a Pi extension and a Claude Code `SessionStart` hook that put the packet in
front of every new session; `integrations/README.md` says how to install them.

## Connecting the two plans

**Claude.** Kinas never reads Claude Code's login or talks to Anthropic (Anthropic's credential rules forbid
it). Instead, add these three lines to `~/.claude/statusline-command.sh`, directly after `input=$(cat)`:

```bash
# Kinas: hand Claude's plan limits to the Kinas app — nothing else from this input
kinas_f="$HOME/Library/Application Support/ai.sintralabs.kinas/inbox/claude-rate-limits.json"
{ mkdir -p "${kinas_f%/*}" && echo "$input" | jq -c '{rate_limits, session_id, captured_at: (now * 1000 | floor)}' > "$kinas_f.$$" && mv -f "$kinas_f.$$" "$kinas_f" || rm -f "$kinas_f.$$"; } 2>/dev/null
```

Settings (⌘,) shows the same lines with Copy buttons and whether the hook is being received. Do not add a
`refreshInterval`: a timer re-run would stamp old numbers as fresh.

**Ollama Cloud.** Create an API key on ollama.com and paste it into Settings. It is stored in the macOS
Keychain (service `ai.sintralabs.kinas`, account `ollama-cloud-api-key`), never in the store or logs.

## The pages

Amended 2026-09-22 (design system). The sidebar lists Home, Work, Crew, Inbox, Usage, Reader and Settings, then your
client folders — every git repository up to three levels under the projects folder, each with a colour chip that
stays with it (Settings → Client folders picks the colour and marks a folder internal, which lists it last with a
tag; a click opens the folder in the reader, and the row offers the terminal and pin buttons every folder row has) —
and, at the foot, the VPS connection when one is configured: connected, stale or error, the Hostinger reader's own word.
Amended 2026-09-23 (folder views): the navigation is Home, Work, Crew, Inbox and Usage — a file's row opens the
reader, so there is no Reader row — with Settings as the sidebar's last row, and Recent under the client folders.
Amended 2026-09-24 (the reader's layout): Recent has left the sidebar — the files opened this session are the
reader's tabs — and a folder is kept at hand by pinning it.
Amended 2026-09-24 (the reader's layout): Kinas draws the window's title bar. Beside the traffic lights sit the
sidebar button, which does what ⌘S does, and **←** and **→**, which walk back and forth through the places you have
been, pages and files alike, like a browser. The rest of the bar moves the window and zooms it on a double-click.
Right-click a client folder to hide it from the sidebar and Home, to show a hidden one, or to add any folder inside
the projects folder, git or not; Settings → Client folders does the same and also removes a folder from Kinas —
restorable there, and never touched on disk. Amended 2026-09-23 (tree changes): every file tree follows the disk and
marks what changed since it was first shown — a status dot and **A**, **M** or **D**, a count on a folder with changes
inside, deleted rows kept struck through — and a click on a marked file opens the reader on **Changes**, a diff against
that moment (a deleted file shows what it said). **↻** on the tree, or **Refresh files** in the palette, clears the marks
and starts again; so does reloading the window. Kinas only watches: nothing is committed, reverted or stored.
**Home** (⌘1) is the first page: the night's progress per
client folder, what is waiting on you, the three usage gauges that decide the day and anything past its threshold.
**Work** (⌘2) is the terminal under a slim chrome. **Usage** (⌘4) is one section per provider. **Crew** and
**Inbox** wait for Build 3 and say so. Every surface is built
from `DESIGN.md`'s tokens and components (`app/src/ui/`); a test refuses any raw colour, size or spacing outside
`app/src/styles/tokens.css`.
Amended 2026-09-24 (the first mate): **Crew** (⌘3) shows the crew's fleet — a card per task the first mate knows,
with its state, one lane per project — once Firstmate is installed (below); **Inbox** still waits for its slice.

## The crew

Added 2026-09-24 (the first mate). The crew is Firstmate, adopted (ADR 0016): Kinas's own clone of
`github.com/kunchenguid/firstmate` at `<data dir>/firstmate` — `~/Library/Application Support/ai.sintralabs.kinas/firstmate`
— pinned at `f9f74a1` and reviewed monthly. That folder is Firstmate's home, and **Kinas never writes under it**: it
runs only Firstmate's read-only scripts, with the login shell's `PATH` and `FM_HOME` set. The app keeps a read-only
mirror of the fleet in its own store (the `crew_*` tables): a thread runs `bin/fm-fleet-snapshot.sh --json` at most
once every 5 s — when `data/backlog.md` or `state/home-summary.json` changes, when the Crew page shows, and every minute
while the window is visible (five while it is hidden) — and records every task, when it was first seen, first working,
done and gone. Nothing is deleted from the mirror, and nothing about a task reaches the log beyond counts and times.
Deleting the data directory deletes the clone and the crew's project clones under it.

## Appearance

Kinas draws on one of two grounds: the dark one, or warm white with royal blue — the two fields of the palette
the other way round. Settings → Appearance chooses: Follow macOS (the default, and it follows live), Light or
Dark. It is a Settings control only: there is no ⌘K command and no shortcut. The app sets the window's own
appearance, so the title bar agrees with the page, and the terminal pane, code highlighting and Mermaid
diagrams turn with it. Printing is the same from either.

Amended 2026-09-22 (design system): the same section chooses the **accent** — the colour of the selected nav row,
primary buttons and the selected card's edge — from six swatches or any colour. A shade whose text would fall under
4.5:1 in either theme is not saved; the field offers the nearest one that passes. The fonts (Inter, JetBrains Mono,
Bricolage Grotesque for the wordmark — all OFL) ship inside the app; nothing is fetched.

The `kinas` CLI reads on both grounds without being told which it is on: royal blue and crimson are exact,
and its text uses the terminal's own foreground, bright black and yellow — which in the Kinas pane are the
app's colours. Only the launch screen's logo depends on the ground (see `COLORFGBG` below). A program in the
pane that paints its own 24-bit dark theme does not follow; Claude Code, for one, has `/theme`.

## Environment variables

| Variable | Builds | Purpose |
|---|---|---|
| `KINAS_DATA_DIR` | all | Use another data folder (tests) |
| `KINAS_CONFIG` | all | Read the CLI config from another file |
| `KINAS_ROOT`, `FM_HOME`, `HERDR_SOCKET_PATH`, `CODEX_HOME` | all | Override the projects root, Firstmate home, Herdr socket and Codex folder from the config |
| `KINAS_BIN` | all | Which `kinas` the session-start integrations run |
| `NO_COLOR`, `FORCE_COLOR` | all | The CLI prints no colour with `NO_COLOR`; with `FORCE_COLOR` it prints colour even when piped |
| `COLORFGBG` | all | The terminal's ground, as rxvt, Konsole and iTerm set it (`0;15` is light). The launch screen draws its logo on royal blue when it says light, on navy otherwise. The Kinas pane sets it for the launch screen alone, never for the shell or Herdr |
| `KINAS_PANE_SHELL_ONLY=1` | debug | The terminal runs a plain login shell, no Herdr |
| `KINAS_HERDR_SESSION=<name>` | debug | Attach a named throwaway Herdr session instead of `default` |
| `KINAS_E2E_HERDR_CONFIG_PATH` | debug | `HERDR_CONFIG_PATH` for that session (applied after `HERDR*` is stripped) |
| `KINAS_CLAUDE_PROJECTS_DIR`, `KINAS_PI_SESSIONS_DIR` | debug | Read transcripts from other folders |
| `KINAS_OLLAMA_BASE_URL` | debug | Point the Ollama reader at a stub server |
| `KINAS_E2E_MEMORY_KEYCHAIN=1`, `KINAS_E2E_OLLAMA_KEY` | debug | An in-memory key store, optionally pre-filled |
| `KINAS_E2E_NO_SYSTEM_HOOKS=1` | debug | Do not register the global hotkey or the login item |
| `KINAS_E2E_NO_OPEN=1` | debug | The reader logs an external link click instead of opening the browser |
| `KINAS_E2E_EXPORT_TO=<path>` | debug | The reader's Download writes its copy there instead of raising the macOS save sheet; every rule about where a copy may go still runs |
| `KINAS_E2E_NO_PRINT=1` | debug | Print as PDF logs a line instead of raising the macOS print sheet |
| `KINAS_E2E_TOOL_DIR=<path>` | debug | The crew's tools are looked for only there and in the system's own folders (`/usr/bin`, `/bin`, …), never on the login shell's `PATH` — stub tools for the crew specs (added 2026-09-24, the first mate) |

The WebDriver plugin and the `window.__kinasTest` hooks exist only in debug builds with the `e2e` feature and
`TAURI_ENV_DEBUG`; release builds contain neither.

## Layout

```
app/                 Tauri app: src-tauri/ (Rust: store, PTY, readers, menu bar) and src/ (React webview)
app/src-tauri/src/crew/     the crew's commands: the Firstmate home, its pin, the only runner of its scripts
app/src-tauri/src/readers/crew/ the crew's collector: the snapshot's parse, the word rule, the scheduler, the mirror
app/src/ui/          the component library — one file per DESIGN.md component, a story per state (stories/)
app/src/styles/      tokens.css (every colour, size and space), the page sheets, the guard and contrast tests
app/src/assets/fonts/ Inter, JetBrains Mono, Bricolage Grotesque as woff2, with their OFL licences
cli/                 the kinas CLI (Clack, Ink for the launch screen), compiled by scripts/build-cli.ts
packages/store/      staleness, quota line, StorageAdapter, the CLI's read-only SQLite adapter
packages/commands/   the command registry shared by the CLI and the palette, and the shared theme
packages/context/    the context packet: sources, CLI cache, activity log, agent and operator renderers
integrations/        session-start hooks for Pi and Claude Code
migrations/          forward-only SQL, applied by the app
fixtures/            shared test data (synthetic files are marked .synthetic)
e2e/                 WebdriverIO specs and runner
e2e/fake-firstmate/  a fake Firstmate home for the crew specs: stub scripts that log their argv, fixture snapshots
keymap.md            every key binding
DESIGN.md            the design system: tokens, components, pages — the law for every surface
design/preview.html  DESIGN.md rendered, both themes, for a browser; held equal to tokens.css by a test
docs/design/screens/ Home, Usage, Settings and the stories in both themes, as the e2e captured them
AGENTS.md            how agents work here: the four gates, the resume rule, where the documents live
docs/smoke-test.md   the terminal's acceptance checklist
docs/adr/            the decisions that outlive a feature, numbered, never rewritten (adr.test.ts holds them)
docs/external/       the world outside the repository — names and scopes, never values
tasks/_templates/    the status file, PRD, architecture, build spec, mockup and ADR templates
.claude/skills/      the vendored software-factory skill the gates come from
```

## How work is done

Every feature runs through four gates before implementation code exists — Product, Architecture, Program design,
Vertical slices — each approved by the captain in so many words, with a status file per feature that a fresh
session reads first. `AGENTS.md` is the rule book: the resume rule, the approval protocol, compaction at every
boundary, what skips the gates, and the map from the vendored skill's file layout to `tasks/<feature>/`. The
templates are in `tasks/_templates/`; the tracked part of a feature's folder is its status file, its PRD and
its mockups, which are reviewed inside Kinas with `kinas open`; the build spec stays on the captain's Mac.
