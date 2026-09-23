# Status: The reader's layout — a Contents column you can hide and size, and text that fills the reader

- Gate 1 · Product: in progress — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A, 5A (2026-09-23)
  - Mockups: pending — `mockups/reader.html` (four states of one screen)
- Gate 2 · Architecture: pending — needed: the remembered values touch Rust (`get_ui_prefs`) and the webview
- Gate 3 · Program design: pending
- Gate 4 · Slice plan: pending

## Slices
- [ ] Slice 1 · tracer bullet: <written at Gate 4>

## Notes for a fresh session

- Branch `docs/reader-layout-gate-1`, in the worktree `.claude/worktrees/reader-layout`, from `origin/main` at
  `1394be7`. The main checkout's `main` is behind `origin/main` (it sits at `73c70fd`): read code in this worktree,
  never there.
- The request came with two screenshots: the reader at about 875 px with Contents at 220 px, and the reader
  expanded on a wide screen with the text stopping at 72ch and the right third of it empty.
- The reader's current rules live in `tasks/prd-kinas-open.md` (private, main checkout): R28 is the Contents gate,
  §4 has the "220 px" side column and the "at most 72ch" document. This feature amends both lines; the amendment
  is written there, dated, when the build lands.
- The questions and answers are recorded at the end of `prd.md` §7.
