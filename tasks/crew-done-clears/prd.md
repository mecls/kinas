# Done work clears — Implementation Spec

*2026-09-29. Written from the captain's two reports (§7) and their answers to four questions (§7). To be built from
`origin/main` at `49d185f`. It amends the first mate (`tasks/first-mate/prd.md`): rule 12's view and rule 21's
counts. Every other rule of it stands, the mirror's above all: nothing is ever deleted.*

## 1. Objective

The Crew page's Fleet board and Home's Overnight keep showing finished work. A done task stays on the board for 7
days after it finished and a gone one for 24 hours (first mate, rule 12), and Overnight counts both for up to 24
hours (rule 21). After a night of crew work the board is a column of done cards the captain has already read, and
what is still in flight sinks beneath them. This change lets finished work go once the captain has seen it. A done or
gone task stays on screen while they look at it; the next time they open or reload that page, it is gone. A done
task whose pull request is still open is the exception: it stays until the PR is merged or closed, because it still
needs them. Nothing is deleted: Kinas's record of every task stays whole, and a task's detail and `kinas crew status`
still reach it.

## Announcement

Finished work now clears itself. When a crew task is done, its card stays on the Crew page while you are looking, and
it is gone the next time you open or reload the page. Home's Overnight does the same: it tells you once what got done
while you were away. A task that is done while its pull request is still open stays on the board until the PR is
merged or closed, so nothing that needs you goes missing. Nothing is deleted: `kinas crew status` still lists every
task.

## 2. Business rules (invariants — never violate)

**What counts as finished**

1. **Finished means done or gone.** A task is finished when its word (first mate, rule 20) is **done** (Firstmate's
   backlog says done) or **gone** (the fleet snapshot stopped listing it). Every other word — failed, blocked, needs
   decision, paused, CI red, ready, PR open, working, queued, unknown — is not finished, and this change leaves it
   exactly as it is today: those need the captain, or are still running.
2. **A done task with an open pull request is not finished yet.** While the last `gh` reading of a done task's PR says
   it is open (a draft included), the task stays on the board with its done badge and its PR line, whatever has been
   seen. Kinas keeps reading that PR with `gh pr view` on the same gaps as an in-flight task's. Today it stops at done,
   so a done card's "mergeable" can be days out of date. The reading that finds the PR merged or closed makes the task
   finished from then.
   - A PR `gh` has never read counts as no PR. A PR `gh` cannot read keeps its last reading.
   - A gone task is finished whatever its PR: Kinas no longer hears about it from the snapshot.

**Seen, then cleared**

3. **A page load.** The two surfaces are the Crew page (its Fleet board) and Home (its Overnight). Each has page loads:
   opening the page (from the sidebar, a shortcut or a link), reloading the window, and Kinas starting on that page.
   The board's re-reading on focus, every 30 s and on each new snapshot is not a page load. Between two loads a page's
   list only gains tasks or changes their words; it never loses one, so a card never vanishes under the captain's eyes.
4. **Seen.** A surface has seen a finished task the first time it shows it finished. On the board, that is its card
   with its done or gone badge. In Overnight, it is counted in its folder's row. Kinas stamps the moment, per task and
   per surface, in its own store, so it outlives a reload and a restart.
5. **Cleared.** At each page load, the surface leaves out every task it saw finished before that load. So a task that
   finishes while the captain watches stays until they next open or reload the page. A task that finished while Kinas
   was closed is shown once, on the first load that finds it, and cleared on the load after.
6. **Each surface clears on its own.** Seeing a task counted in Overnight does not clear its card from the board, nor
   the other way round: each page forgets only what it has shown. Otherwise opening Home in the morning would empty the
   board of cards the captain never saw.
7. **A task that comes back is new again.** A gone task that returns to the snapshot, or a done task whose word leaves
   done, loses its seen stamps. When it finishes again, each surface shows it and clears it afresh.
8. **The old windows stay, as ceilings.** Rule 12's windows still bound what is shown: a done task leaves 7 days after
   `done_at` and a gone one 24 hours after `gone_at`, seen or not, open PR or not. A finished task the captain never
   opens a page to see still goes then.

**What moves with it**

9. **Lanes and counts follow the board.** A lane exists while its folder has a task on the board (rule 19), so a lane
   whose tasks have all cleared goes with them. `in flight` and `queued` never counted finished tasks and do not change.
   The waiting count (rule 16) counts decisions and held tasks, never finished ones, and does not change.
10. **Overnight keeps its window and its words.** Rule 21's window and its four counts stand; a finished task Overnight
    has already shown is left out at the next load. A folder with nothing left in its window reads, as today, `No work
    overnight in this folder.`
11. **Nothing is deleted, and nothing else forgets.** The mirror's rows, events and timeline stay (rule 12). A task's
    detail opens whatever its age. `kinas crew status` lists what it lists today: the CLI has no pages and no loads. The
    seen stamps are Kinas's own and never reach Firstmate; Kinas still writes nothing to Firstmate.

## 3. Flows

1. **The snapshot, as today.** Firstmate's fleet snapshot fills the mirror; a task's `done_at` and `gone_at` are stamped
   as they are now. A task that returns, or leaves done, has its seen stamps removed in the same write (rule 7).
2. **The PR of a done task.** Each collector cycle reads, with `gh pr view` (10 s), the PRs of tasks not done, as now,
   and also of done tasks whose last reading is open (rule 2). A reading that fails keeps the last one and is tried
   again after the usual gap, never in a tight loop.
3. **A page load.** The page notes the moment it loaded and asks for its list with it. Kinas returns the tasks inside
   the windows (rule 8), minus the finished tasks this surface saw before that moment (rule 5).
4. **What the page shows.** Each time the page draws its list, it tells Kinas which finished tasks it now shows, and
   Kinas stamps those not stamped yet for that surface. If the stamp cannot be written (the store busy or failing), the
   task is simply not stamped: it is shown again at the next load, never cleared unseen.
5. **Between loads.** Re-reads use the load's moment, so nothing the page shows can clear before the next load.

## 4. Surfaces

- **The Crew page, Fleet board.** Finished cards leave as rules 3–8 say; a done card with an open PR stays and its PR
  line keeps up with GitHub. There is no new control and no new word. A lane with nothing left goes. With no task on
  the board at all, the page shows its existing empty state, `No tasks — ask in the first mate's pane`.
- **Home, Overnight.** A folder's row counts only what this surface has not cleared. Its SectionHeader caption (`since
  23:40 yesterday, 9 h 51 m`) is unchanged.
- **Unchanged:** the task detail panel, the Inbox, the Usage page's crew section, the menu bar, `kinas crew status`.

No DESIGN.md component changes: Card, StatusBadge, ProgressRow and SectionHeader are used as they are. DESIGN.md's
notes on the Fleet board and Overnight gain a dated sentence each (slice 0).

**Screens:**
- `mockups/fleet-board.html` — one lane at three moments: a task finishes while you watch, then a reload (the done card
  with an open PR stays), then its PR merged and one more reload.
- `mockups/home-overnight.html` — Overnight on the first open of the morning, and after a reload.

## 5. Validation

**Rust unit tests** (a store with the mirror's tables, a fake fleet, and `gh` answers stubbed as the crew's tests do
now):
- A done task is in the board's list until the board stamps it; still in it for any read with a load moment before
  the stamp; out of it for a load after (rules 3–5).
- The same for Overnight, and a board stamp does not clear it from Overnight, nor the reverse (rule 6).
- A done task whose PR reads open stays after being seen and a reload; the reading that says merged, then a stamp and
  a reload, clears it (rule 2). A PR never read counts as none.
- A gone task that returns, and a done task that leaves done, lose their stamps (rule 7).
- At 7 days after `done_at` and 24 h after `gone_at` the task is out whatever its stamps (rule 8).
- The mirror's row count and events are unchanged by any stamp or read (rule 11).

**The e2e** (the crew board's fake home and stub `gh`, as `crew-board.e2e.ts` runs now), run alone:
1. A task turns done while the Crew page shows it: its card stays through two 30 s re-reads.
2. A reload: the card is gone, and its lane with it if it was the lane's last task.
3. A done task whose stub PR reads open: after being seen and a reload, still there, with a fresh PR line.
4. The stub PR turns merged: the card stays until the next reload, then goes.
5. Home after a fake night: Overnight counts the done tasks; a reload of Home: those counts are gone, and the Crew page
   still shows their cards once (rule 6).
6. `kinas crew status` lists every task before and after.

**The whole of it:** `bun run check` green; the full e2e suite green in one run, alone; the private-names check over
every added line and commit message returns 0.

## 6. Out of scope

- **Deleting rows or pruning the store.** Rule 12 stands: the record is whole, forever.
- **A "show done" control, or a history view.** The captain's answer: off the board, still in the record (§7.4).
- **The CLI.** `kinas crew status` has no pages, so nothing there is seen or cleared.
- **Failed, blocked and every other unfinished word.** They need the captain, or are running (rule 1).
- **Merging or closing a PR, or telling Firstmate anything.** Kinas still only reads.
- **The Inbox.** Decisions close themselves when Firstmate closes them (rule 7 of the first mate).

## 7. Open questions

1. **One seen stamp per surface (rule 6), or one for both?** Proposed: per surface, so the board never loses a card
   the captain only saw counted on Home. The captain decides at Gate 1.
2. **Gone follows done.** The captain's first report asked for the board to reset "when the crewmates are gone", so
   gone tasks clear the same way as done ones (rule 1). The captain may keep gone tasks for their 24 hours instead.

**Asked before writing, 2026-09-29, and answered:**
1. When should a done task leave the Fleet board? **At your next reload** — a task that finishes while you watch stays;
   once you reload the window or open the Crew page again, it is gone.
2. A task Firstmate marks done while its PR is still open: clear it too? **Keep it until the PR merges or closes.**
3. Home's Overnight uses the same list: should it reset the same way? **Yes, clear what you have seen.**
4. Where do cleared tasks go? **Off the board, still in the record** — no "show done" control.

**The reports:**
- 2026-09-27: "once the job is finished and the crewmates are gone (essentially when the crew stopped working and all
  work is done), it should be cleaned so it should reset. At the moment it's just staying there. It's not cleaning the
  already done work" (screenshots of the Fleet board and Home's Overnight).
- 2026-09-29: "But did we also implement the tasks in the Crew page cleaning after a run? Like, if that specific Thing
  is done it should be cleaned if I reload the page" (a Fleet lane of done cards).
