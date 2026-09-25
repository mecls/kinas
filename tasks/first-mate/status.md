# Status: The first mate inside Kinas (Build 3)

- Gate 1 · Product: APPROVED 2026-09-23, twice — first that morning, then again after slice 0's probe reopened it.
  Firstmate does not take the captain's answers through `fm-send.sh`: it closed a held landing without landing it, and
  the first mate refused the approval as not coming from its chat (`build-spec.md` §17). The captain answered 1A, 2A,
  3A; `prd.md` is revised (rules 5–8, 16, 18, the flows, the Inbox, AC-5/7/12/13/14, §7), with ADRs 0016 and 0017,
  DESIGN.md 1.7 and `keymap.md`'s amendment.
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
- [x] Slice 1 · tracer bullet: a task in the fake home is a card on the Crew page — *2026-09-24: a filed task is a card
  in 558–638 ms (AC-3); check green, the crew-collector, shell, palette, keyboard, settings and stories specs green alone*
- [x] Slice 2 · installed: `kinas crew setup`, the tools, Settings grouped with the Crew card — *2026-09-24: the real
  setup ran on this Mac (Firstmate at f9f74a1, backend herdr); check green; crew-collector, crew-settings, settings,
  stories, screens and shell green alone*
- [x] Slice 3 · launchable: the first mate in the pane, the start focus, the chrome → ship point 1 — *shipped
  2026-09-25 on the captain's push: rebased onto `7e917ff` (the drawn title bar), check green, the full e2e alone green
  (31 specs, 183 cases); PR #38, `main` at `c5209fa`; installed in `/Applications`, schema 5, AC-21's median 36 ms*
- [x] Slice 4 · the board by repository, PRs and checks, the task detail in the panel, Usage's Crew section —
  *2026-09-25: AC-4, AC-6, AC-7 green in crew-board.e2e.ts; check green; the crew, usage, stories, screens, shell,
  title-bar and reader-panel specs green alone*
- [x] Slice 5 · the Inbox, answers copied for the first mate's chat, held tasks, one waiting count (sidebar, Crew,
  menu bar) — *2026-09-25: AC-5, AC-12, AC-14 green in crew-inbox.e2e.ts; the launcher now types only into an idle
  shell; check green; the crew, palette, keyboard, settings, shell, stories, screens and reader-panel specs green
  alone*
- [x] Slice 6 · the order log — *2026-09-25: AC-8 green in crew-orders.e2e.ts (28 ms); keyboard, selection and
  reader-terminal green alone; check green*
- [x] Slice 7 · Home: the crew's night and Waiting on you — *2026-09-25: AC-15's Home half green in crew-home.e2e.ts;
  home and screens unchanged with no crew; check green*
- [x] Slice 8 · Add to crew — *2026-09-25: AC-17 green in crew-add.e2e.ts; folders green; check green*
- [x] Slice 9 · reconciliation, the context packet, the sweep → ship point 2 — *shipped 2026-09-25 on the captain's
  push: AC-9 green in crew-reconcile-a/-b, AC-13 in crew-collector, AC-19 in features and mirror tests; rebased onto
  `375c759`, check green, the full e2e alone green (38 specs, 201 cases); the PR, the install and AC-21/22 in
  `build-spec.md` §19*

## Notes for a fresh session

- **Build 3 is done: both ship points are on `main` (PR #38 and ship point 2's).** What is left is the captain's —
  `build-spec.md` §19 "Needs the captain" and `docs/smoke-test.md` "The crew: needs the captain". The worktree
  `.claude/worktrees/design-system` and its branch `feat/crew` go when the captain says so. Read `build-spec.md` §0
  before anything else; `tasks.md` is the task list, ticked as the work happened.
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
- **DESIGN.md 1.4 and 1.7 and `keymap.md`'s Build 3 amendments** were written with the PRD and its reopening.
- **Firstmate.** The pin is `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540` (reviewed monthly; the fleet ledger is worth
  adopting at the next review, after this build ships — §17). Read the pin from a scratch clone and run none of its
  scripts outside a throwaway probe. Kinas's own clone lives under the data directory
  (`docs/external/firstmate-home.md`).
- **Standing rules.** Kinas never runs `quota-axi`, writes nothing under Firstmate's home, and runs none of its scripts
  that change anything — `fm-send.sh` included (ADR 0016); the captain's answers go on the clipboard for the first
  mate's chat (ADR 0017). No test or probe touches Herdr's `default` session; set `HERDR_SESSION`, because Firstmate
  falls back to `default` without it. Workers start in Claude Code's Bypass Permissions mode; accepting it is the
  captain's call at their first real worker.
- The process is `AGENTS.md`; the templates are in `tasks/_templates/`; the repository-wide decisions are
  `docs/adr/0001`–`0017` (this feature's: 0014 and 0015, superseded by 0016 — Firstmate adopted, only its read-only
  scripts run — and 0017 — Kinas's words to the first mate, a launch sentence or a line on the clipboard).
