# Status: Tree changes clear on push — a mark goes when its change is pushed; ↻ clears only what no push will

- Gate 1 · Product: APPROVED 2026-09-25 — `prd.md`, from the captain's answers 1A, 2A, 3A (§7); approved as written,
  so §7.1 (↻'s tooltip) and §7.2 (↻ stays shown) stand
  - Mockups: APPROVED 2026-09-25 — `mockups/sidebar-push.html`
- Gate 2 · Architecture: APPROVED 2026-09-25 — `architecture.md`, private, at its absolute path in the main checkout
  (`tasks/tree-changes-push/architecture.md`), with its three PRD clarifications written into `prd.md` as dated
  notes (rules 1, 2 and 12). The ADR it offers (0018, "Kinas reads a repository's own refs and never fetches") is
  not written: the captain approved the gate without a word on it
- Gate 3 · Program design: APPROVED 2026-09-25 — `build-spec.md` §11, private, in the main checkout beside
  `architecture.md`, approved as written
- Gate 4 · Slice plan: APPROVED 2026-09-25 — `build-spec.md` §12, five slices, one ship point at slice 4; building on
  `feat/tree-changes-push`

## Slices
- [ ] Slice 0 · ground, docs first: the worktree's build, DESIGN.md 1.8, keymap.md, README.md, smoke-test.md
- [ ] Slice 1 · tracer bullet: the upstream, a watch on the repository's refs, and a push clears an M
- [ ] Slice 2 · counting from the push: each mark's own "since", the diff from the pushed text, D and added folders
- [ ] Slice 3 · bursts and ↻: a pull is no mark, ↻ clears only what no push will, the words
- [ ] Slice 4 · edges and the record → ship point: worktrees, a root below its repository, git failing, the timings

## Notes for a fresh session

- The feature amends the shipped tree changes (`tasks/tree-changes/prd.md`): its rules 15, 16 and 18, answer 1A
  and the §6 line on git. That PRD carries a dated closing note pointing here (2026-09-25), and is not otherwise edited.
- Worktree `.claude/worktrees/tree-changes-push`, branch **`feat/tree-changes-push`**, from `origin/main` at
  `c5209fa`, made with `--no-track` so a bare `git push` can never reach `main`. Nothing is pushed without the
  captain's word.
- The `tree-changes` worktree (`docs/tree-changes-installed`) belongs to another session. Leave it alone.
- The main checkout stays at `73c70fd`, with another session's untracked `docs/overview.md` and
  `tasks/design-system/`: never pull, switch, stash or commit there while worktrees exist.
- The captain's screenshot that started this showed four marks, all on git-ignored private documents
  (`tasks/*/build-spec.md`). That is why answer 1A matters: a push can never clear those, and ↻ must.
