# Status: The first mate inside Kinas (Build 3)

- Gate 1 · Product: in progress
  - Mockups: pending, one per screen (`mockups/board.html`, `mockups/task-detail.html`, `mockups/inbox.html` exist, empty)
- Gate 2 · Architecture: in progress
- Gate 3 · Program design: in progress
- Gate 4 · Slice plan: pending

## Slices
- [ ] Slice 0 · ground, and the probe that decides whether there is a build (a real first mate in a throwaway Herdr session; if it fails, the build stops and reports)
- [ ] Slice 1 · the mirror: migration 0005, the collector over the fake home, `kinas crew status`
- [ ] Slice 2 · installed, launchable: `kinas crew setup`, tool health in Settings, the launcher, ⌘3 → ship point 1
- [ ] Slice 3 · the board: lanes, cards, task detail, the PR and its checks, the crew section on Usage
- [ ] Slice 4 · the inbox and the orders: answers through `fm-send.sh`, the order log
- [ ] Slice 5 · reconciliation, Settings, the launch screen, the sweep → ship point 2

## Notes for a fresh session

- **Read `build-spec.md` §16 first** (the decisions log: everything settled with the captain on 2026-09-22 and every default). The build spec is private — `.gitignore` tracks only this file, `prd.md` and `mockups/` — so read it at its absolute path in the main checkout (`git worktree list` names it first): `tasks/first-mate/build-spec.md`. The PRD is tracked beside this file.
- **Where each gate stands.** Gate 1: the PRD was written 2026-09-22 and its ten open questions answered (the trailing note in `prd.md`; `build-spec.md` §16); the announcement paragraph and the screens line were added 2026-09-22; the three mockups are empty and unapproved — nothing has yet been approved with "Approve Gate N, or what should change?". Gate 2: `build-spec.md` §9 is the architecture today; an `architecture.md` (Gate 2, private) is to be extracted from it — fit by file and line, the commands and tables, the flow, the externals by name. Gate 3: `build-spec.md` exists without §11's five sections (files, types and signatures, call stack, test plan, at least five least-confident decisions) — write them, then present Gate 3. Gate 4: `build-spec.md` §11 "Build order" (its six phases, the slices above) is the slice plan, unapproved; it becomes §12 when §11 is inserted.
- **Gate 3 must reconcile the spec with `DESIGN.md`.** DESIGN.md (v1.1, 2026-09-22) arrived after the spec was written. The spec's §9 puts the Crew page's components in `app/src/crew/` with plain CSS in `crew.css`; DESIGN.md §9 says components live once in `app/src/ui/<Component>.tsx` with semantic tokens only, and §4 already names Lane, Card, Status badge, Timeline and Inbox item. Decide where the first mate's components go and how they take their tokens before writing §11.1 — and the mockups (Gate 1) are drawn with DESIGN.md's tokens, so the answer starts there.
- The Firstmate pin is `f9f74a1d91cc7e105ec3df2249eda4e07f9ba540` (its `origin/main` on 2026-09-22, reviewed monthly). Its home will be Kinas's own clone under the data directory (`docs/external/firstmate-home.md`); the captain's existing clone of Firstmate elsewhere on this Mac holds a session lock and is out of bounds — read-only, never a session, never a script, never a `git fetch`.
- The probe (slice 0) stops the build if it fails: no tmux fallback, no mirror. Kinas never runs `quota-axi`; Kinas's own code writes nothing under Firstmate's home; the one mutating script is `fm-send.sh`, on a click.
- The process this feature runs under is `AGENTS.md` at the repo root; the templates are in `tasks/_templates/`; the repository-wide decisions are `docs/adr/0001`–`0014` (0014 is this feature's).
