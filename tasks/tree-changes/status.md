# Status: Tree changes — what changed on disk, marked in the file trees, with a diff

- Gate 1 · Product: APPROVED 2026-09-23 — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A, 5B+C+D (5A left in: a diff is in scope), 6A; approved as written, so §7.1 (a click on a marked row opens Changes) and §7.2 (the caption) stand
  - Mockups: APPROVED 2026-09-23 — `mockups/sidebar-tree.html`, `mockups/reader-changes.html`
- Gate 2 · Architecture: APPROVED 2026-09-23 — `architecture.md`, private, at its absolute path in the main checkout (`tasks/tree-changes/architecture.md`), with its four PRD clarifications written into `prd.md` as dated notes (rules 3, 5, 15; §7.3 closed)
- Gate 3 · Program design: APPROVED 2026-09-23 — `build-spec.md` §11, private, in the main checkout beside `architecture.md`
- Gate 4 · Slice plan: APPROVED 2026-09-23 — `build-spec.md` §12, eight slices; building on `feat/tree-changes`, rebased onto `origin/main` at `dd21e35` with the five Gate commits on top (PR #31 still shows them on the old base: close it for the build PR, or merge it first — the captain's call)

## Slices
- [x] Slice 0 · ground: branch, `similar` pinned, `listable_name`/`listable_file` split out, docs first — 2026-09-23, `bun run check` green (564 bun, 188 Rust, 0 clippy warnings, 55 s)
- [ ] Slice 1 · tracer bullet: save a file, see an M (watch, stub burst, event, ChangeMark, caption)
- [ ] Slice 2 · the real marks outside git: baseline walk and copies, rule 3, deleted rows, roll-ups, live re-list
- [ ] Slice 3 · git as the baseline's source: clean blobs, hash-object, nested repositories
- [ ] Slice 4 · refresh and reload: ↻ on every tree head, the palette command, `on_page_load` → ship point 1
- [ ] Slice 5 · the Changes view for a modified or added file: diff, folds, toggle, live re-diff, refusals
- [ ] Slice 6 · deleted files: the record's text, Copy and Download, the disabled menu items
- [ ] Slice 7 · the edges and the record: rescan, the log grep, the timings → ship point 2

## Notes for a fresh session

- Worktree `.claude/worktrees/tree-changes`, branch `feat/tree-changes`, on `origin/main` at `dd21e35` (2026-09-23;
  the Gate documents were first written on `docs/tree-changes-gate-1` from `1394be7`, PR #31). Its Rust target is an
  APFS clone of a warm target at the same base (`cp -Rc`): a cold one costs 6–8 GB and the disk is near full.
- The build's draft PR is #32 (`feat/tree-changes` → `main`); it holds the Gate commits too, so #31 can close for it.
  Next: slice 1, the tracer bullet — `build-spec.md` §12.
- The main checkout is at `73c70fd`, behind `origin/main`, with another session's untracked `docs/overview.md` and
  `tasks/design-system/`: never pull, switch, stash or commit there while worktrees exist.
- The captain's two screenshots did not reach the session that wrote Gate 1; the "reload" they showed was read as
  WebKit's own right-click menu (Reload, Inspect Element — `Sidebar.tsx` names it), which reloads the whole window.
  A window reload also restarts the terminal pane (`PtyState::start`, `pty.rs`), which is why answer 2A adds a
  Refresh button that clears marks without it.
- The questions and answers are recorded in `prd.md` §7.
