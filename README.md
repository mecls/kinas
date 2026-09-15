# Kinas

A local macOS app with two pages and a CLI:

- **Usage** — how much of the Claude and Ollama Cloud plans is left (with how old each number is), model
  usage by day from Claude Code and Pi transcripts, and this Mac's CPU, memory and disk.
- **Work** — the terminal: a real PTY running your login shell, attached to Herdr, with a keyboard contract
  that gives every non-⌘ key to the terminal.
- **`kinas`** — the CLI. With no arguments, a launch screen that says where the operation is right now; `kinas
  context --agent` prints the same situation as a markdown packet for the start of an agent session.

Everything runs on this Mac. State is one SQLite file in `~/Library/Application Support/ai.sintralabs.kinas/`,
written only by the app; the CLI keeps its own cache beside it.
The product spec is `tasks/prd-kinas-build-1.md`; the build plan is `tasks/tasks-kinas-build-1.md`.

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
| `kinas` | The launch screen: identity on the left; projects, crew, sessions, decisions, quotas and recent activity on the right. Drawn from the cached packet (about 0.1 s), refreshed in the background |
| `kinas context` | The counts, what is waiting on you, and what changed recently |
| `kinas context --agent` | The whole context packet as markdown: `# Kinas context`, `## Projects`, `## Artifacts`, `## Conventions`, `## Crew`, `## Sessions`, `## Decisions`, `## Quotas`, `## Recent` — rarely-changing sections first |
| `kinas context --agent --cwd <dir>` | The same, or nothing when `<dir>` is outside the projects root (for session hooks) |
| `kinas context --refresh` | Recompute the cached packet; prints nothing |
| `kinas status [--json]` | The Usage page as text or JSON |
| `kinas open <file>` | The path of a markdown file (the app has no reader yet) |

No command reads keys: nothing captures Tab, and every command prints and exits.

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
docs/smoke-test.md   the terminal's acceptance checklist
```
