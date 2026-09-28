# Status: Crew marks — what the crew is changing and hasn't pushed, marked on the captain's own tree

- Gate 1 · Product: APPROVED 2026-09-28 — `prd.md`, from the captain's answers 1A, 2A, 3A, 4A+C (§7); approved as
  written, so §7.1 (any tree with the same remote), §7.2 (no task names) and §7.3 (the crew's added rows) stand
  - Mockups: APPROVED 2026-09-28 — `mockups/sidebar-crew.html`, `mockups/reader-crew.html`
- Gate 2 · Architecture: APPROVED 2026-09-28 — `architecture.md`, private, in the main checkout
  (`tasks/crew-marks/architecture.md`), with its four PRD clarifications written into `prd.md` as dated notes (rules
  1, 4, 11 and 14), and **ADR 0019**'s text (superseding 0018), to be written and locked in slice 0
- Gate 3 · Program design: APPROVED 2026-09-28 — `build-spec.md` §11, private, in the main checkout, approved as
  written
- Gate 4 · Slice plan: APPROVED 2026-09-28 — `build-spec.md` §12, five slices, one ship point at slice 4; building on
  `feat/crew-marks`

## Slices
- [x] Slice 0 · the probe, and docs first: ADR 0019, firstmate-home.md, DESIGN.md 1.9, keymap, README, smoke-test —
  2026-09-28; the probe passed (the crew clone's worktree list names its live `~/.treehouse` checkout); baseline
  `bun run check` green (721 bun, 365 Rust); docs only after it, `bun test` green
- [x] Slice 1 · tracer bullet: a crew worktree's save marks the captain's row — 2026-09-28, `bun run check` green (724
  bun, 369 Rust); `crew-marks` 2 of 2, `tree-changes` 20 of 20, `-no-git` and `-watch-fail` green, run alone; the
  negative control failed in Rust and in the e2e, as it must
- [x] Slice 2 · what counts, where it shows, and when it goes: rule 4 whole, crew rows, roll-ups, pushes and worktrees —
  2026-09-28, `bun run check` green (727 bun, 379 Rust); `crew-marks` 4 of 4, `tree-changes` 20 of 20, `-no-git` and
  `-watch-fail` green, run alone
- [x] Slice 3 · the crew's Changes view: the read-only door, the fourth view button, the guard, the stories —
  2026-09-28, `bun run check` green (728 bun, 381 Rust); the guard's negative control failed as it must; `crew-marks`
  5 of 5, `stories` 2 of 2 (its contract re-recorded byte-identical), `tree-changes` 20 of 20, `-no-git` and
  `-watch-fail` green, run alone
- [x] Slice 4 · the edges and the record → ship point — 2026-09-28: ↻, bursts and a reset leave the crew's view alone
  (its negative control failed as it must); `crew-marks` 9 of 9 with `crew 6–8` and the timing; a recomputation
  32–79 ms on the fixture, 199 ms median on a Kinas-sized crew clone. **Ship point:** `origin/main` unmoved (`fa52b8e`),
  `bun run check` green (728 bun, 382 Rust), the full e2e alone 39 of 39 specs (215 cases), save-to-mark median
  150.5 ms, private names clean. **On the captain's word (2026-09-28):** pushed as
  PR #43 and fast-forwarded onto `main`. A release build of `993d698` was made (no test seams in the binary);
  **not installed** — the install, which quits the running Kinas and replaces `/Applications/Kinas.app`, is left for
  the captain to run

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
- Pending with the captain (asked twice, 2026-09-27 and 28, not yet answered): their report that done work stays on the
  Fleet board and in Home's Overnight after the crew stops — the first mate's feature (its PRD rules 12 and 21); whether
  to pass it to the first mate's session or keep it for after crew marks.
