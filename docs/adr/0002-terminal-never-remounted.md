# 0002 · The terminal is never remounted; nothing above it is conditionally rendered

Date: 2026-09-14
Status: accepted

## Context

The Work page's terminal is an xterm.js pane on a Rust PTY that runs a login shell and attaches Herdr's persistent session. In React, unmounting that component — or wrapping, re-keying or conditionally rendering any ancestor of it — creates a new one, which spawns a new PTY and drops Herdr's client: the session survives, but the pane goes blank and the shell that was there is gone. Build 1 made it rule R33 (2026-09-14); the three-column shell of 2026-09-18 restated it as its invariant 6.1 when the reader became a panel beside the page and every page had to stay mounted. Recorded here on 2026-09-22.

## Decision

The React tree above `<Terminal>` is static. Every page stays mounted and only its visibility changes (the `hidden` attribute and data attributes); the sidebar, the stage, the page, the divider and the panel are always in the tree. Nothing that is an ancestor of the terminal is wrapped, re-keyed, or rendered behind a condition, and no page component is defined inside another component's render. Becoming visible re-measures and refocuses the terminal; it never re-creates it.

## Consequences

A new surface — a page, a panel, a strip — is added to the static tree with `hidden`, never with `&&`. Tests assert the PTY's pid across every shell action: opening and closing the reader, switching pages, hiding the window, opening a folder in the terminal. Enforced by `app/src/App.tsx:43-49` (the rule, with the tree at `:319-360`), `app/src/pages/Work.tsx:4-8`, and the `ptyPid` assertions in `e2e/specs/reader.e2e.ts:77-153`, `reader-panel.e2e.ts:69-96`, `reader-terminal.e2e.ts:173-194` and `pane.e2e.ts:20-34`.
