# Herdr's `default` session

## What it is

Herdr is the session runtime in the Work page's terminal (Herdr 0.9.0 today). The captain's real work lives in its **`default`** session: the pane Kinas's PTY attaches at launch, and where Claude Code or Pi is usually holding the prompt. Everything Kinas does to a session goes through Herdr's CLI with a fixed argv — `app/src-tauri/src/reader/herdr.rs` is the one door (ADR 0003).

## Where

- The socket: Herdr's own, overridable with `HERDR_SOCKET_PATH` (`~/.config/kinas/config.json` or the env var; `README.md` → Environment variables).
- The binary: `~/.local/bin/herdr`, else the first `herdr` on PATH (`find_herdr`).
- Every child call strips every `HERDR*` variable from its environment and is limited to 3 s (`HERDR_TIMEOUT`); `KINAS_E2E_HERDR_CONFIG_PATH` is applied after the strip, in debug builds only.

## Who reads it

- The PTY (`pty.rs`) attaches `default` as its first command, or the session named by `KINAS_HERDR_SESSION` in a debug build (`herdr.rs`, `session()`; letters, digits, `-` and `_` only).
- Open in editor (`reader/editor.rs`) and Open in the terminal (`reader/workspace.rs`): `api snapshot`, `pane split`, `pane run`, `workspace create --cwd … --label … --focus`, `workspace focus`.
- Build 3's launcher and the crew's worker panes (`fm-<id>` tabs in a `firstmate` workspace of the same session).
- Amended 2026-09-24 (the first mate, slice 3): the door moved to `app/src-tauri/src/herdr.rs`, crate-wide. The crew's thread asks `api snapshot` once per cycle (the live view: which workspace and pane are focused, the worker panes behind each task's `endpoint.target`) and `pane process-info` for the focused pane (its foreground `argv0`, never `name`, which is Claude Code's version). The launcher (`crew/launch.rs`, serialised by `herdr::OPENING`) finds the workspace labelled `firstmate`, focuses it, and only when `claude` is not already its focused pane's foreground runs `pane run <pane> claude` — or `workspace create --cwd <Firstmate's home> --label firstmate --focus` and then that `pane run` in its root pane. Once per run, within 10 s of the crew thread starting, it focuses an existing `firstmate` workspace.

## What it can do

Split, create, focus, run a command in a pane — and, through `pane send-text` / `send-key`, type into one. Typed text is the dangerous half: when Claude Code or Pi has the pane, it arrives as a prompt.

## Never

- **Tests never touch `default`.** Every e2e spec that needs Herdr creates a throwaway session named for it (`kinas-e2e-terminal`, `kinas-e2e-crew` for the crew's launcher, start focus and chrome specs, …) in its `<name>.setup.ts`, stops it before and after (`stopHerdrSession`), attaches it with `KINAS_HERDR_SESSION`, and points it at its own config with `onboarding = false` (`e2e/specs/reader-terminal.setup.ts` is the template). A probe by hand uses a throwaway session too.
- Kinas typing into its own PTY, or into any pane of `default`, from any code path: no `cd`, no `pane run` into Kinas's pane, no `send-text`. Tests assert the PTY's pid across every shell action and that the pane's text contains no typed command.
- Amended 2026-09-24 (the first mate): the one `pane run` besides Open in editor's is the launcher's, into the `firstmate` workspace's pane only, and its whole command is `claude` or ADR 0017's one sentence as `claude`'s single argument; `KINAS_E2E_CREW_COMMAND` (debug) replaces the program `claude` with a stand-in for tests. A worker's pane is only ever focused (`workspace focus`), never run into.
- A shell string: every Herdr call is a fixed argv; a folder or label is one element, never interpolated.
- Herdr's error text, a folder, or a label in the log — Herdr's messages echo `--cwd`. The log holds the outcome and the duration only.
