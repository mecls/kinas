# Status: The interface polish — the reference app's look on Kinas's way of working

- Gate 1 · Product: APPROVED 2026-11-15 — `prd.md`, from the captain's answers 1C, 2A, 3A, 4 none (§7); approved
  as written, so §7.1–§7.4 stand as proposed (the status bar always on; up to three tasks under a folder; Settings
  keeps the window's sidebar; Recent is anything opened anywhere)
  - Mockups: APPROVED 2026-11-15 — `mockups/window.html`, `mockups/palette.html`, `mockups/settings.html`,
    `mockups/usage.html`, `mockups/crew-and-files.html`
- Gate 2 · Architecture: APPROVED 2026-11-15 — `architecture.md`, private, at its absolute path in the main checkout
  (`tasks/interface-polish/architecture.md`), written 2026-11-15, with its five PRD clarifications written into
  `prd.md` as dated notes (rules 9, 13, 15, 25, 36); no ADR proposed
- Gate 3 · Program design: APPROVED 2026-11-15 — `build-spec.md` §11, private, in the main checkout beside
  `architecture.md`, approved as written (§11.5's eight calls stand)
- Gate 4 · Slice plan: APPROVED 2026-11-15 — `build-spec.md` §12, private: twelve slices, three ship points (after 4, 7, 11); building on
  `feat/interface-polish` in `.claude/worktrees/interface-polish`

## Slices
- [x] Slice 0 · ground: the worktree, `scripts/private-names` restored by the captain, the Gate 1 files committed, the docs first (DESIGN.md 1.11, keymap.md, README, the Herdr entry, the smoke test) — 2026-11-16: `ad1c936`, `0fed5e0`, local; baseline `bun run check` green (738 bun, 391 Rust, 269 s). Before slice 1: rebase onto `origin/main` (`c6246ee`)
- [x] Slice 1 · tracer bullet: ⌘K finds a stubbed file and opens it; the status bar row stands; `ptyPid` unchanged — 2026-11-16, `1cc8106`, local: palette 7/7, statusbar 3/3, layout specs 28/28, cargo 458, clippy clean; `bun test` timed out in untouched tests under heavy load (build-spec §17)
- [x] Slice 2 · the real file index (`search.rs`) and the palette's rows, commands with their chords — 2026-11-16, local: Rust 10 new tests, clippy clean; bun 19 new tests; palette.e2e 8/8 (one unexplained miss in four runs, build-spec §17), stories 2/2 (contract only gained the row), staleness 4/4, tree-changes 22/22; rule 18 probe 45 ms slowest over 63,915 entries in a debug build. `bun run check`: two failures outside the branch's code under load (crew-setup timeouts; the review's 4 MB diff test passing its 500 ms deadline), build-spec §17
- [ ] Slice 3 · the palette's in-window sources: open tabs, folders, tasks, inbox, settings; the sidebar's Search row
- [ ] Slice 4 · Workspaces, Recent, the failure lines → ship point 1
- [ ] Slice 5 · the look: neutral dark, new tokens, group labels, `Kbd`, names lead, empty states; contracts re-recorded
- [ ] Slice 6 · the status bar for real, the usage popover, reset captions; the sidebar's connection row gone
- [ ] Slice 7 · the sidebar's live folders and nav chords → ship point 2
- [ ] Slice 8 · Home (quiet line, attention without heroes) and Usage (chart trim)
- [ ] Slice 9 · Settings: section list, search, rows, folding lines
- [ ] Slice 10 · line counts on changed files
- [ ] Slice 11 · the record: screens, smoke test, private names → ship point 3

## Notes for a fresh session

- The start (2026-11-15): the captain sent ten screenshots of Orca, an agent IDE whose look they like, and asked
  for Kinas to be compared against it: "I like the images a lot but I still prefer how our UX works." The
  comparison and the four questions are in `prd.md` §7; the screenshots themselves are not in the repository.
- The captain works in the **light** theme and likes it as it is: no light token changes value (rule 3).
- Gate 1 docs are written in the main checkout and not committed; nothing is pushed without the captain's word.
- Worktrees open at the time: `.claude/worktrees/crew-firstmate-current` (`feat/crew-firstmate-current`) and `saithe`
  (`feat/review-session-code-bugs`). Build this one in its own worktree from `origin/main` once Gate 4 is approved.
