# Status: Crew marks — what the crew is changing and hasn't pushed, marked on the captain's own tree

- Gate 1 · Product: in progress — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A+C (§7), awaiting approval
  - Mockups: in progress — `mockups/sidebar-crew.html`, `mockups/reader-crew.html`
- Gate 2 · Architecture: pending (with an ADR superseding 0018, for the new reads under Firstmate's home)
- Gate 3 · Program design: pending
- Gate 4 · Slice plan: pending

## Slices
(Planned at Gate 4.)

## Notes for a fresh session

- The captain's report, 2026-09-27: "When firstmate makes changes and is working I don't see the changes in the left
  side bar". Cause: the crew's workers edit their own worktrees of Kinas's crew clone under Firstmate's home
  (`<data dir>/firstmate/projects/<name>`), never the captain's checkout, so tree changes — which follows the disk of
  the folder shown — has nothing to mark. Offered: open the crew's copy, mark crew edits on my tree, mark what a pull
  brings, or leave it. The captain chose **mark crew edits on my tree**.
- It builds on tree changes and tree changes clear on push (both on `main`); every rule of theirs stands.
- ADR 0018 lists every read under Firstmate's home and says a new read needs a new record superseding it: this feature
  reads the crew's checkouts, so Gate 2 comes with that ADR, before any code. The first mate's session wrote 0018 and
  builds the crew; keep it informed.
- Worktree `.claude/worktrees/crew-marks`, branch **`feat/crew-marks`**, from `origin/main` at `fa52b8e`, made with
  `--no-track`. Nothing is pushed without the captain's word.
- The main checkout stays at `73c70fd`, with another session's untracked `docs/overview.md` and `tasks/design-system/`:
  never pull, switch, stash or commit there while worktrees exist.
- Fixtures and documents use a made-up client folder (`shop`); no client's name goes into a tracked file.
