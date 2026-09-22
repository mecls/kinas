# 0003 · Kinas never types into its own terminal; Herdr's CLI with a fixed argv is the only way to act on a session

Date: 2026-09-16
Status: accepted

## Context

The obvious way to "open this file in an editor" or "start a shell in that folder" from a terminal app is to write the command into the pane, as if the user had typed it. In Kinas the pane is usually held by Claude Code or Pi, and text written into it arrives as a prompt — an order to an agent, not a shell command. The PTY's folder is also fixed when it spawns, and restarting it drops Herdr's client (ADR 0002). Open in editor (Build 2, 2026-09-16) chose the other road; Open in the terminal (2026-09-21) walked it again, measuring Herdr 0.9.0's flags in a throwaway session first. Recorded here on 2026-09-22.

## Decision

Kinas never writes into its own PTY from any code path, and never types into any pane of Herdr's `default` session. To act on a session — split a pane, run a command in one, create or focus a workspace — Kinas runs Herdr's CLI as a child process with a fixed argv: one element per argument, never a shell string, every `HERDR*` variable stripped from the child's environment, a 3 s limit. One module, `reader/herdr.rs`, is the door; a new action adds a function there and nowhere else.

## Consequences

Anything Herdr's CLI cannot do, Kinas cannot do to a session — that is the price, and it is paid rather than typed around. Tests plant a marker in every folder name and assert the pane's text never contains a typed `cd` and the PTY's pid never changes. Enforced by `app/src-tauri/src/reader/herdr.rs:1-3`, `:15-23` (`herdr_args`, pinned by its test at `:98-102`), `:47-54` (the env strip and the limit), `app/src-tauri/src/reader/workspace.rs:87` (the one argv), and `e2e/specs/reader-terminal.e2e.ts:20-21`, `:193-195`, `:242-248` (`TYPED_CD` never matches).
