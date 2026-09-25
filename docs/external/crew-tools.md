# The crew's tools

## What it is

The command-line tools Firstmate's scripts run, installed on the captain's Mac by `kinas crew setup` at exact versions (Firstmate's floors at its pin, `f9f74a1`). They are the captain's programs, run as the captain; Kinas only installs them on a yes, and checks they are there. The one list is `app/src-tauri/src/crew/pin.rs` (`TOOLS`, `PREREQS`), held equal to `packages/commands/src/crew-tools.ts` through `fixtures/crew-tools.json`.

| Tool | Version | Floor | From | Goes to | Prints a `setup hooks` line |
|---|---|---|---|---|---|
| `treehouse` | 2.3.0 | `--lease` in `treehouse get --help` | GitHub release `kunchenguid/treehouse`, `treehouse-v2.3.0-darwin-arm64.tar.gz`, checked against its pinned SHA-256 | `~/.local/bin` | no |
| `no-mistakes` | 1.79.0 | 1.46.0 | GitHub release `kunchenguid/no-mistakes`, `no-mistakes-v1.79.0-darwin-arm64.tar.gz`, checked against its pinned SHA-256 | `~/.local/bin` | no |
| `gh-axi` | 0.1.35 | 0.1.29 | npm, `npm install -g gh-axi@0.1.35` | npm's global prefix | yes |
| `tasks-axi` | 0.2.5 | 0.2.4 | npm | npm's global prefix | no |
| `quota-axi` | 0.1.49 | 0.1.29 | npm | npm's global prefix | no |
| `chrome-devtools-axi` | 0.1.35 | — | npm | npm's global prefix | yes |
| `lavish-axi` (optional) | 0.1.76 | 0.1.46 | npm | npm's global prefix | yes |

Prerequisites, checked and never installed: `git`, `gh`, `node`, `npm`, `jq`, `python3`, `herdr`, `claude`.

## Where

On the login shell's `PATH` (`~/.local/bin`, npm's global prefix — under nvm on this Mac). `kinas crew setup` asks the login shell for its `PATH` once and runs every step with it.

## Who reads it

- `kinas crew setup` (`cli/src/crew-setup.ts`): `command -v`, each tool's version, `npm install -g <name>@<version>`, the release download, `shasum -a 256` against the pinned value, the extract into `~/.local/bin`.
- The app (`app/src-tauri/src/crew/tools.rs`): whether each tool is installed at or above its floor, every 60 s at most, for Settings → Crew and the Crew page's Launch. A release tool's version comes from `<tool> --version`; an npm tool's from the `package.json` its command links to — no npm tool is ever run by the app.
- Firstmate's own scripts, in the first mate's and the workers' panes.

## What it can do

`gh-axi` and `gh` act on GitHub as the captain; `tasks-axi` files Firstmate's tasks; `quota-axi` reads Claude Code's login and calls Anthropic; `treehouse` makes worktrees; `no-mistakes` runs checks. The `setup hooks` of `gh-axi`, `chrome-devtools-axi` and `lavish-axi` write under `~/.claude`.

## Never

- `curl … | sh`, or any install without an exact version — and, for a release, without its pinned checksum matching. A changed checksum for the same tag is not installed.
- Run a tool's `setup hooks`: setup prints the line for the captain to run.
- Run `quota-axi` from Kinas, even for its version (ADR 0018).
- Move a version or a floor without moving the Firstmate pin, and the pin only with the captain.
