# Status: Done work clears — the Fleet board and Overnight forget what you have seen

- Gate 1 · Product: APPROVED 2026-09-29 — `prd.md`, from the captain's answers (§7); approved as written, so §7.1
  (one seen stamp per surface) and §7.2 (gone clears like done) stand as proposed
  - Mockups: APPROVED 2026-09-29 — `mockups/fleet-board.html`, `mockups/home-overnight.html`
- Gate 2 · Architecture: APPROVED 2026-09-29 — `architecture.md`, private, in the main checkout
  (`tasks/crew-done-clears/architecture.md`): two stamp columns on `crew_tasks` (migration 0006), `finished()` in
  Rust, a `crew_seen` command, the PRs of done tasks read while open, each page filtering by its own load; no ADR
- Gate 3 · Program design: APPROVED 2026-09-29 — `build-spec.md` §11, private, in the main checkout, approved as
  written
- Gate 4 · Slice plan: APPROVED 2026-09-29 — `build-spec.md` §12, five slices, one ship point at slice 4; building on
  `feat/crew-done-clears`

## Slices
- [x] Slice 0 · the probe (migration 0006 on a copy of the captain's store), and docs first — 2026-09-29: baseline
  `bun run check` green (728 bun, 382 Rust); the probe passed (schema 5, 0006 applies; 13 tasks, 12 done, 2 gone);
  DESIGN.md 1.10, the first mate's PRD, github-cli.md, README and the smoke test amended, `bun test` green
- [x] Slice 1 · tracer bullet: a done card leaves the board at the next load — 2026-09-29: migration 0006,
  `finished()`, `crew_seen`, `useCleared` on the Crew page; `bun run check` green (732 bun, 388 Rust); the negative
  control failed as it must; `crew-done-clears` 2 of 2, `crew-board` 5 of 5, `crew-home` 1 of 1, run alone
- [x] Slice 2 · a done task with an open PR stays until it merges — 2026-09-29: the collector reads a done task's PR
  while it reads open; `bun run check` green (732 bun, 390 Rust); `crew-done-clears` 4 of 4, `crew-board` 5 of 5, run
  alone
- [x] Slice 3 · Overnight, and a task that comes back — 2026-09-29: Home clears what Overnight counted, a returning
  task forgets its stamps; `bun run check` green (733 bun, 391 Rust); the negative control failed as it must;
  `crew-done-clears` 6 of 6, `crew-home` 1 of 1, `crew-board` 5 of 5, run alone
- [x] Slice 4 · the record → ship point — 2026-09-29: `origin/main` unmoved (`49d185f`), `bun run check` green (733
  bun, 391 Rust), the full e2e alone 40 of 40 specs (221 cases), private names clean. **Waiting on the captain:** push
  and the PR, the merge to `main`, the release build; the install is theirs to run

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
