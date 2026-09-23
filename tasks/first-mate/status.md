# Status: The first mate inside Kinas (Build 3)

- Gate 1 · Product: in progress — `prd.md` revised 2026-09-23 with the captain's answers, awaiting approval
  - Mockups: seven, drawn 2026-09-23 on the library's own CSS, awaiting approval — `board`, `task-detail`,
    `inbox`, `home`, `settings-crew`, `work`, `usage-and-menu-bar`
- Gate 2 · Architecture: pending — `architecture.md` (private) not written; start from `review-2026-09-23.md`
- Gate 3 · Program design: pending — `build-spec.md` (2026-09-22, base `592fcce`, 42 commits behind `1394be7`) is
  rewritten at this gate, with the five sections it lacks
- Gate 4 · Slice plan: pending

## Slices (proposed 2026-09-23; Gate 4 decides)
- [ ] Slice 0 · the probe and the read at the pin — stops the build if Firstmate's Herdr backend fails on 0.9.0;
  answers `prd.md` §7 1–6
- [ ] Slice 1 · the mirror: migration 0005, the collector over the fake home, `kinas crew status`
- [ ] Slice 2 · installed and launchable: `kinas crew setup`, Settings grouped with the Crew card, the launcher, ⌘3 and
  ⌘5, the Work pane opening on the first mate, the chrome → ship point 1
- [ ] Slice 3 · the board, the task detail in the right panel, Usage's Crew section
- [ ] Slice 4 · the Inbox page, answers through `fm-send.sh`, held tasks, the one waiting count (sidebar, Home, Crew,
  menu bar), the order log
- [ ] Slice 5 · Home: the crew's night and Waiting on you
- [ ] Slice 6 · Add to crew
- [ ] Slice 7 · reconciliation, the launch screen and `kinas context` from the mirror, Features in progress, the sweep
  → ship point 2

## Notes for a fresh session

- **Read `prd.md` first.** It was revised on 2026-09-23 and is the current product document; where it and
  `build-spec.md` differ, the PRD wins until Gate 3 rewrites the spec. Its §7 records the captain's answers of
  2026-09-22 and 2026-09-23.
- **The private documents** sit at their absolute paths in the main checkout (`git worktree list` names it first),
  `tasks/first-mate/`:
  - `build-spec.md` — 2026-09-22; its §16 decisions stand wherever the PRD does not change them.
  - `review-2026-09-23.md` — Firstmate at the pin, field by field, with every argv and exit code; the build spec's 22
    stale references to the code; what the design system had already decided. Gates 2 and 3 start here.
  - `plan-2026-09-23.md` — the captain's consolidated plan, verbatim.
  - `build_mockups.py` — generates the seven mockups from the template's tokens, `app/src/ui/*.css` and one body per
    screen. Regenerate after a change rather than editing the HTML by hand.
- **DESIGN.md 1.4 and `keymap.md`'s Build 3 amendments** were written with this PRD, in the same change.
- **Firstmate.** The pin is `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540` (reviewed monthly; answer 4A keeps it, and slice
  0 reads the newer `state/fleet-ledger.jsonl` on its `main`). The captain's old clone at `~/Documents/Projects/firstmate`,
  which `build-spec.md` §0.7 reads from, no longer exists: read the pin from a scratch clone, and run none of its
  scripts. Kinas's own clone will live under the data directory (`docs/external/firstmate-home.md`).
- **Standing rules.** The probe stops the build if it fails: no tmux fallback. Kinas never runs `quota-axi`, writes
  nothing under Firstmate's home, and runs one mutating script, `fm-send.sh`, on a click. No test or probe touches
  Herdr's `default` session; set `HERDR_SESSION`, because Firstmate falls back to `default` without it.
- The process is `AGENTS.md`; the templates are in `tasks/_templates/`; the repository-wide decisions are
  `docs/adr/0001`–`0014` (0014 is this feature's).
