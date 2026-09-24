# Status: The first mate inside Kinas (Build 3)

- Gate 1 · Product: APPROVED 2026-09-23, twice — first that morning, then again after slice 0's probe reopened it.
  Firstmate does not take the captain's answers through `fm-send.sh`: it closed a held landing without landing it, and
  the first mate refused the approval as not coming from its chat (`build-spec.md` §17). The captain answered 1A, 2A,
  3A; `prd.md` is revised (rules 5–8, 16, 18, the flows, the Inbox, AC-5/7/12/13/14, §7), with ADRs 0016 and 0017,
  DESIGN.md 1.6 and `keymap.md`'s amendment.
  - Mockups: APPROVED 2026-09-23, seven, drawn on the library's own CSS — `board`, `task-detail`,
    `inbox`, `home`, `settings-crew`, `work`, `usage-and-menu-bar`; `inbox`, `home` and `task-detail` redrawn with
    the reopening
- Gate 2 · Architecture: APPROVED 2026-09-23, twice — `architecture.md` (private, main checkout), from three read
  passes over the tree at `6214108`; its three PRD clarifications are marked in `prd.md`; revised for the reopened
  Gate 1 (decision 11, `crew_answer`)
- Gate 3 · Program design: APPROVED 2026-09-23, and again 2026-09-24 — `build-spec.md` rewritten on the 23rd, §11 the
  program design; revised for the reopened Gate 1 (`crew/answer.rs`, `crew_answer`, invariant 4)
- Gate 4 · Slice plan: APPROVED 2026-09-23, and again 2026-09-24 — `build-spec.md` §12; revised for the reopening
  (slices 1, 4, 5, 8, 9; `tasks.md`)

## Slices (build-spec.md §12, approved 2026-09-23 and 2026-09-24)
- [x] Slice 0 · ground, and the probe that decides whether there is a build (answers `prd.md` §7 q1–q6; stops the
  build if Firstmate's Herdr backend fails on 0.9.0) — *probe done 2026-09-23: Herdr works (q1), `claude '<ask>'`
  works (q2), the snapshot is cheap (q6); q3–q5 answered from the scripts; field paths corrected 2026-09-24 (0.12);
  the baseline (0.2) taken alone 2026-09-24: check green, 21 e2e specs and 122 cases green*
- [ ] Slice 1 · tracer bullet: a task in the fake home is a card on the Crew page
- [ ] Slice 2 · installed: `kinas crew setup`, the tools, Settings grouped with the Crew card
- [ ] Slice 3 · launchable: the first mate in the pane, the start focus, the chrome → ship point 1
- [ ] Slice 4 · the board by repository, PRs and checks, the task detail in the panel, Usage's Crew section
- [ ] Slice 5 · the Inbox, answers copied for the first mate's chat, held tasks, one waiting count (sidebar, Crew,
  menu bar)
- [ ] Slice 6 · the order log
- [ ] Slice 7 · Home: the crew's night and Waiting on you
- [ ] Slice 8 · Add to crew
- [ ] Slice 9 · reconciliation, the context packet, the sweep → ship point 2

## Notes for a fresh session

- **Next: slice 1, the tracer bullet (`tasks.md` 1.0).** The work is in the worktree
  `.claude/worktrees/design-system` on branch `feat/crew` (`build-spec.md` §17, 0.1), local commits only — nothing
  pushed. Read `build-spec.md` §0 before anything else; `tasks.md` is the task list, ticked as the work happens.
- **Read `prd.md` first.** It was revised on 2026-09-23, reopened the same day by slice 0's probe and approved again;
  its §7 records the captain's answers of 2026-09-22 and 2026-09-23 and the probe's. Where it and `build-spec.md`
  differ, the build spec wins and its §17 says why.
- **The private documents** sit at their absolute paths in the main checkout (`git worktree list` names it first),
  `tasks/first-mate/`:
  - `architecture.md` — Gate 2: eleven decisions, every touch-point by file and line, the commands, the tables and their
    queries, the flows, the externals.
  - `build-spec.md` — Gate 3 (§11, the program design) and Gate 4 (§12, the slice plan), both approved again on
    2026-09-24; §17 holds slice 0's findings and every decision since. The first version is kept as
    `build-spec-2026-09-22.md`; nothing in it binds.
  - `tasks.md` — 101 sub-tasks, one parent per slice.
  - `review-2026-09-23.md` — Firstmate at the pin, field by field, with every argv and exit code.
  - `plan-2026-09-23.md` — the captain's consolidated plan, verbatim.
  - `build_mockups.py` — generates the seven mockups from the template's tokens, `app/src/ui/*.css` and one body per
    screen. Regenerate after a change rather than editing the HTML by hand.
- **DESIGN.md 1.4 and 1.5 and `keymap.md`'s Build 3 amendments** were written with the PRD and its reopening.
- **Firstmate.** The pin is `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540` (reviewed monthly; the fleet ledger is worth
  adopting at the next review, after this build ships — §17). Read the pin from a scratch clone and run none of its
  scripts outside a throwaway probe. Kinas's own clone will live under the data directory
  (`docs/external/firstmate-home.md`).
- **Standing rules.** Kinas never runs `quota-axi`, writes nothing under Firstmate's home, and runs none of its scripts
  that change anything — `fm-send.sh` included (ADR 0016); the captain's answers go on the clipboard for the first
  mate's chat (ADR 0017). No test or probe touches Herdr's `default` session; set `HERDR_SESSION`, because Firstmate
  falls back to `default` without it. Workers start in Claude Code's Bypass Permissions mode; accepting it is the
  captain's call at his first real worker.
- The process is `AGENTS.md`; the templates are in `tasks/_templates/`; the repository-wide decisions are
  `docs/adr/0001`–`0017` (this feature's: 0014 and 0015, superseded by 0016 — Firstmate adopted, only its read-only
  scripts run — and 0017 — Kinas's words to the first mate, a launch sentence or a line on the clipboard).
