# Status: Tree changes — what changed on disk, marked in the file trees, with a diff

- Gate 1 · Product: in progress — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A, 5B+C+D (5A left in: a diff is in scope), 6A
  - Mockups: in progress — `mockups/sidebar-tree.html`, `mockups/reader-changes.html`
- Gate 2 · Architecture: pending (Rust and the webview are both touched, so `architecture.md` will be written)
- Gate 3 · Program design: pending
- Gate 4 · Slice plan: pending

## Slices
- [ ] Slice 1 · tracer bullet: to be planned at Gate 4

## Notes for a fresh session

- Worktree `.claude/worktrees/tree-changes`, branch `docs/tree-changes-gate-1`, cut from `origin/main` at `1394be7`
  (2026-09-23). The main checkout is at `73c70fd`, behind `origin/main`, with another session's untracked
  `docs/overview.md` and `tasks/design-system/`: never pull, switch, stash or commit there while worktrees exist.
- The captain's two screenshots did not reach the session that wrote Gate 1; the "reload" they showed was read as
  WebKit's own right-click menu (Reload, Inspect Element — `Sidebar.tsx` names it), which reloads the whole window.
  A window reload also restarts the terminal pane (`PtyState::start`, `pty.rs`), which is why answer 2A adds a
  Refresh button that clears marks without it.
- The questions and answers are recorded in `prd.md` §7.
