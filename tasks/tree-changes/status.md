# Status: Tree changes — what changed on disk, marked in the file trees, with a diff

- Gate 1 · Product: APPROVED 2026-09-23 — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A, 5B+C+D (5A left in: a diff is in scope), 6A; approved as written, so §7.1 (a click on a marked row opens Changes) and §7.2 (the caption) stand
  - Mockups: APPROVED 2026-09-23 — `mockups/sidebar-tree.html`, `mockups/reader-changes.html`
- Gate 2 · Architecture: APPROVED 2026-09-23 — `architecture.md`, private, at its absolute path in the main checkout (`tasks/tree-changes/architecture.md`), with its four PRD clarifications written into `prd.md` as dated notes (rules 3, 5, 15; §7.3 closed)
- Gate 3 · Program design: APPROVED 2026-09-23 — `build-spec.md` §11, private, in the main checkout beside `architecture.md`
- Gate 4 · Slice plan: APPROVED 2026-09-23 — `build-spec.md` §12, eight slices; building on `feat/tree-changes`, rebased onto `origin/main` at `dd21e35` with the five Gate commits on top (PR #31 still shows them on the old base: close it for the build PR, or merge it first — the captain's call)

## Slices
- [x] Slice 0 · ground: branch, `similar` pinned, `listable_name`/`listable_file` split out, docs first — 2026-09-23, `bun run check` green (564 bun, 188 Rust, 0 clippy warnings, 55 s)
- [x] Slice 1 · tracer bullet: save a file, see an M (watch, stub burst, event, ChangeMark, caption) — 2026-09-24, `bun run check` green (575 bun, 194 Rust); `tree-changes.e2e.ts` and the four row-matching specs green, run alone
- [x] Slice 2 · the real marks outside git: baseline walk and copies, rule 3, deleted rows, roll-ups, live re-list — 2026-09-24, `bun run check` green (581 bun, 217 Rust); `tree-changes.e2e.ts` (7) and the four row-matching specs green, run alone
- [x] Slice 3 · git as the baseline's source: clean blobs, hash-object, nested repositories — 2026-09-24, `bun run check` green (581 bun, 229 Rust); `tree-changes` (7) and `tree-changes-no-git` (1) green, run alone
- [x] Slice 4 · refresh and reload: ↻ on every tree head, the palette command, `on_page_load` → ship point 1 — 2026-09-24;
  ship point 1 verified on `9207e6c`: `bun run check` green (591 bun, 237 Rust), the full e2e alone, all 25 specs green
  (`tree-changes` 10 of 10). **Merged to `main` (`cbab8be`, PR #34) on the captain's word; not installed** — the
  captain installs once the first mate's build is done
- [x] Slice 5 · the Changes view for a modified or added file: diff, folds, toggle, live re-diff, refusals — 2026-09-24,
  `bun run check` green (600 bun, 250 Rust); `tree-changes` 12 of 12, every reader spec and `stories` green, run alone
- [x] Slice 6 · deleted files: the record's text, Copy and Download, the disabled menu items — 2026-09-24,
  `bun run check` green (600 bun, 252 Rust); `tree-changes` 13 of 13, every reader spec green, run alone
- [x] Slice 7 · the edges and the record: rescan, the log grep, the timings → ship point 2 — 2026-09-24, rebased onto
  `6b754ee` (the reader's layout's ship point 2, landed first on the captain's word): `bun run check` green (601 bun,
  258 Rust); `tree-changes` 15 of 15, the write-to-mark median 100 ms. **Ship point 2 verified on `dae41eb`**: the full
  e2e alone, all 26 specs green (19:52–20:37). **On `main` by fast-forward on the captain's word
  (PR #37), 2026-09-24; not installed** — the captain installs after the first mate's build

## Notes for a fresh session

- Worktree `.claude/worktrees/tree-changes`, branch **`feat/tree-changes-2`**, rebased onto `origin/main` at `a01dec1`
  (2026-09-24, the reader's layout's ship point 1) for this feature's ship point 1. Its Rust target is an APFS clone
  of a warm target (`cp -Rc`): a cold one costs 6–8 GB and the disk is near full.
- The build's draft PR is **#34** (`feat/tree-changes-2` → `main`). The captain chose a new branch over a force-push:
  #32 (`feat/tree-changes`, the pre-rebase tip, also kept locally as `tree-changes-before-rebase`) is closed for it,
  and #31 (the Gate documents on their first base) is still open — #34 holds those commits too.
- Ship point 1 is on `main` at `cbab8be` (2026-09-24), not installed. Slices 5 and 6 (the Changes view, deleted files)
  went up as draft PR #35 from `feat/tree-changes-2`. DESIGN.md's entry is 1.6: the reader's layout took 1.5. #31 (the
  Gate documents on their first base) is still open, and everything in it is on `main` now.
- **Ship point 2 follows the reader's layout's** (the captain's order, 2026-09-24): this build is rebased onto its
  ship point 2 (`6b754ee`, tabs) as **`feat/tree-changes-3`**, a new branch as at ship point 1; its PR is **#37**, and #35 is closed for it. It went to `main` by fast-forward
  on the captain's word on 2026-09-24.
  The six conflicts and the one decision they needed — a deleted file gets a tab — are in the build spec's §17.
- The main checkout is at `73c70fd`, behind `origin/main`, with another session's untracked `docs/overview.md` and
  `tasks/design-system/`: never pull, switch, stash or commit there while worktrees exist.
- The captain's two screenshots did not reach the session that wrote Gate 1; the "reload" they showed was read as
  WebKit's own right-click menu (Reload, Inspect Element — `Sidebar.tsx` names it), which reloads the whole window.
  A window reload also restarts the terminal pane (`PtyState::start`, `pty.rs`), which is why answer 2A adds a
  Refresh button that clears marks without it.
- The questions and answers are recorded in `prd.md` §7.
