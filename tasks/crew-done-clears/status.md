# Status: Done work clears — the Fleet board and Overnight forget what you have seen

- Gate 1 · Product: APPROVED 2026-09-29 — `prd.md`, from the captain's answers (§7); approved as written, so §7.1
  (one seen stamp per surface) and §7.2 (gone clears like done) stand as proposed
  - Mockups: APPROVED 2026-09-29 — `mockups/fleet-board.html`, `mockups/home-overnight.html`
- Gate 2 · Architecture: APPROVED 2026-09-29 — `architecture.md`, private, in the main checkout
  (`tasks/crew-done-clears/architecture.md`): two stamp columns on `crew_tasks` (migration 0006), `finished()` in
  Rust, a `crew_seen` command, the PRs of done tasks read while open, each page filtering by its own load; no ADR
- Gate 3 · Program design: in progress — `build-spec.md` §11, private, in the main checkout
- Gate 4 · Slice plan: pending

## Slices
- [ ] (planned at Gate 4)

## Notes for a fresh session

- The captain's reports: "once the job is finished and the crewmates are gone (essentially when the crew stopped
  working and all work is done), it should be cleaned so it should reset. At the moment it's just staying there. It's
  not cleaning the already done work" (2026-09-27, with screenshots of the Fleet board and Home's Overnight), and "if
  that specific Thing is done it should be cleaned if I reload the page" (2026-09-29, a Fleet lane of done cards).
- It amends the first mate (`tasks/first-mate/prd.md`): rule 12's view (a done task shown for 7 days, a gone one for 24
  hours) and rule 21's Overnight counts. Every other rule of it stands; the mirror still never deletes. The first
  mate's PRD gets a dated note pointing here in slice 0, as tree changes' did for tree changes clear on push.
- Worktree `.claude/worktrees/crew-done-clears`, branch **`feat/crew-done-clears`**, from `origin/main` at `49d185f`
  (crew marks, PR #43), made with `--no-track`. Nothing is pushed without the captain's word.
- The main checkout stays at `73c70fd`, with another session's untracked `docs/overview.md` and `tasks/design-system/`,
  and the captain's `design/dock-logo.png` (now in PR #44 as `app/src-tauri/icons/source/dock-logo.png`): never pull,
  switch, stash or commit there while worktrees exist.
- Fixtures and documents use made-up folders (`shop`, `harbor-api`); no client's name goes into a tracked file.
