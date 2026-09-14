# Kinas

A local macOS app with two pages and a CLI:

- **Usage** — how much of the Claude and Ollama Cloud plans is left (with how old each number is), model
  usage by day from Claude Code and Pi transcripts, and this Mac's CPU, memory and disk.
- **Work** — the terminal: a real PTY running your login shell, attached to Herdr, with a keyboard contract
  that gives every non-⌘ key to the terminal.
- **`kinas status`** — the Usage page as text or JSON, from the same store, read-only.

Everything runs on this Mac. State is one SQLite file in `~/Library/Application Support/ai.sintralabs.kinas/`.
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
cli/                 the kinas CLI (Clack), compiled with Bun and bundled as an external binary
packages/store/      staleness, quota line, StorageAdapter, the CLI's read-only SQLite adapter
packages/commands/   the command registry shared by the CLI and the palette
migrations/          forward-only SQL, applied by the app
fixtures/            shared test data (synthetic files are marked .synthetic)
e2e/                 WebdriverIO specs and runner
keymap.md            every key binding
docs/smoke-test.md   the terminal's acceptance checklist
```
