# Status: The first mate inside Kinas (Build 3)

- Gate 1 · Product: APPROVED 2026-09-23 — `prd.md` revised that day with the captain's answers
  - Mockups: APPROVED 2026-09-23, seven, drawn on the library's own CSS — `board`, `task-detail`,
    `inbox`, `home`, `settings-crew`, `work`, `usage-and-menu-bar`
- Gate 2 · Architecture: APPROVED 2026-09-23 — `architecture.md` (private, main checkout), from three read passes
  over the tree at `6214108`; its three PRD clarifications are marked in `prd.md`
- Gate 3 · Program design: APPROVED 2026-09-23 — `build-spec.md` rewritten that day; §11 is the program design
- Gate 4 · Slice plan: in progress — `build-spec.md` §12, written 2026-09-23, awaiting approval

## Slices (build-spec.md §12; proposed, Gate 4 decides)
- [ ] Slice 0 · ground, and the probe that decides whether there is a build (answers `prd.md` §7 q1–q6; stops the
  build if Firstmate's Herdr backend fails on 0.9.0)
- [ ] Slice 1 · tracer bullet: a task in the fake home is a card on the Crew page
- [ ] Slice 2 · installed: `kinas crew setup`, the tools, Settings grouped with the Crew card
- [ ] Slice 3 · launchable: the first mate in the pane, the start focus, the chrome → ship point 1
- [ ] Slice 4 · the board by repository, PRs and checks, the task detail in the panel, Usage's Crew section
- [ ] Slice 5 · the Inbox, answers through `fm-send.sh`, held tasks, one waiting count (sidebar, Crew, menu bar)
- [ ] Slice 6 · the order log
- [ ] Slice 7 · Home: the crew's night and Waiting on you
- [ ] Slice 8 · Add to crew
- [ ] Slice 9 · reconciliation, the context packet, the sweep → ship point 2

## Notes for a fresh session

- **Read `prd.md` first.** It was revised on 2026-09-23 and is the current product document; where it and
  `build-spec.md` differ, the PRD wins until Gate 3 rewrites the spec. Its §7 records the captain's answers of
  2026-09-22 and 2026-09-23.
- **The private documents** sit at their absolute paths in the main checkout (`git worktree list` names it first),
  `tasks/first-mate/`:
  - `architecture.md` — Gate 2: ten decisions, every touch-point by file and line, the commands, the tables and their
    queries, the flows, the externals. Gate 3 writes the build spec from it.
  - `build-spec.md` — rewritten 2026-09-23 (Gate 3): §11 is the program design, §12 the slice plan once Gate 4 is
    approved. The first version is kept as `build-spec-2026-09-22.md`; nothing in it binds.
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
  `docs/adr/0001`–`0015` (0014 and 0015 are this feature's: Firstmate adopted, and Kinas's only words to it).
