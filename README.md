# Kinas
<img width="2288" height="1160" alt="SL" src="https://github.com/user-attachments/assets/94271395-da35-4f67-ae6f-eb9d96e91752" />

The operating system for a company that runs on AI agents. Local first, one person first.

Kinas is a Mac app with the kinas CLI inside it. It gives one developer a single place to work: a terminal pane with Herdr and the crew, a usage page that shows what every provider subscription and this machine are doing, and, as the agents move in, the run feed, the approvals that reach your phone, and the deployer that ships client changes with rollback.

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
| `kinas open [<name or path>] [--anywhere] [--launch]` | Open any file whose content reads as text — `.md` and `.mdx` render as markdown, images as images, `.html` renders as the page it is — in an isolated frame that runs its own inline scripts but reaches no network — each with a click-only Rendered / Source toggle, and everything else as highlighted source with line numbers — or a folder, in the reader, the panel on the right of the window beside whichever page is showing, from any folder: an argument is tried as a path where you are, then under the projects folder, then searched for by name under it (`kinas open reader.md`, `reader`, `0008_funnel_stage.sql`, or `Dockerfile`). Several matches list a picker in the reader and open nothing until you click one; no path reopens the last file. The projects folder comes from `KINAS_ROOT`, else Settings → Projects folder, else `~/.config/kinas/config.json`. Paths outside it are refused unless `--anywhere`, which asks for a click. Prints the resolved path, or every match. In the reader's header: Copy the file's text, and under ▾ download a copy through the macOS save sheet, print to PDF through the print sheet, open it in an editor pane, or pin it to the sidebar — a folder opened this way lists there, and pins survive a relaunch while the Recent list does not. Folders are first-class in the sidebar: an opened folder joins Recent, and a folder's row — in a file tree, in Recent, in Pinned, or the Files header — shows a pin button and a terminal button when pointed at. The terminal button asks Herdr for that folder's workspace and takes you to the Work page: one workspace per folder, labelled with its path under the projects folder, and a second click focuses it rather than making another (rename it in Herdr, or change the projects folder, and the next click makes a new one). Nothing is typed into the pane. Exit 0 (opened, asked, or Kinas not running: the path is printed), 1, 64 usage, 65 not a text file (binary content, or not a regular file), 66 no such file or nothing to reopen, 77 outside the folder |

Only the launch screen reads keys (Enter, q, Ctrl+C; see `keymap.md`); it ignores Tab and everything else, and every
other command prints and exits.

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

## Environment variables

| Variable | Builds | Purpose |
|---|---|---|
| `KINAS_DATA_DIR` | all | Use another data folder (tests) |
| `KINAS_CONFIG` | all | Read the CLI config from another file |
| `KINAS_ROOT`, `FM_HOME`, `HERDR_SOCKET_PATH`, `CODEX_HOME` | all | Override the projects root, Firstmate home, Herdr socket and Codex folder from the config |
| `KINAS_BIN` | all | Which `kinas` the session-start integrations run |
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

The WebDriver plugin and the `window.__kinasTest` hooks exist only in debug builds with the `e2e` feature and
`TAURI_ENV_DEBUG`; release builds contain neither.

## Layout

```
app/                 Tauri app: src-tauri/ (Rust: store, PTY, readers, menu bar) and src/ (React webview)
cli/                 the kinas CLI (Clack, Ink for the launch screen), compiled by scripts/build-cli.ts
packages/store/      staleness, quota line, StorageAdapter, the CLI's read-only SQLite adapter
packages/commands/   the command registry shared by the CLI and the palette, and the shared theme
packages/context/    the context packet: sources, CLI cache, activity log, agent and operator renderers
integrations/        session-start hooks for Pi and Claude Code
migrations/          forward-only SQL, applied by the app
fixtures/            shared test data (synthetic files are marked .synthetic)
e2e/                 WebdriverIO specs and runner
keymap.md            every key binding
DESIGN.md            the design system: tokens, components, pages — the law for every surface
design/preview.html  DESIGN.md rendered, both themes, for a browser
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
