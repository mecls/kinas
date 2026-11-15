# Firstmate, current — Implementation Spec

*2026-11-15. Written from the captain's ask and their five answers (§7), after reading Firstmate at its current `main`
(`427056c`, 2026-11-12) against the pin (`f9f74a1`, 2026-09-22) and Anthropic's terms as they stand today. It amends
the first mate (`tasks/first-mate/prd.md`): rules 1, 5, 8 and 20 and the card's elapsed time, as §2 says. Every other
rule of it stands — Kinas builds only the bridge, never types into a pane, writes nothing under Firstmate's home, and
the captain answers only in the first mate's chat. It is built after `feat/review-session-code-bugs` lands on `main`
(§7, answer 4).*

## 1. Objective

Kinas's crew runs Firstmate pinned at 22 September. Firstmate has moved 495 commits since: fixes to supervision,
Herdr, teardown and merging that Kinas's crew does not get, and new facts it now publishes that the Crew page cannot
show — the branch a task works on, a ship lane parked on purpose while its PR waits for a human review, the PR a held
task is about, how many lanes are free and why dispatch is held, and, in an opt-in ledger, the real times a task was
dispatched, had its PR ready, merged and was cleaned up. This change moves the pin to Firstmate's current `main`,
installs and launches it as today, and shows those facts on the Crew page, the task detail, the Inbox, Home's
Overnight, Usage and Settings. Claude Code stays the first mate's harness and the coding agent Kinas starts; the
captain's Claude subscription is used only by the official `claude` they signed into, as Anthropic's terms allow
(§7, the reading of 2026-11-15).

One thing changed under Kinas's feet and is accepted here on the captain's word: Firstmate's fleet snapshot, which
Kinas runs, now records the commit a `local-only` project's finished task will land (rule 3). That is Firstmate's own
write under its own locks, and a new decision record says so.

## Announcement

Kinas now runs the current Firstmate. Open a task and the right panel names its branch; with the fleet ledger on, its
timeline shows when it was really dispatched, when its PR was ready, when it merged and when it was cleaned up, and the
card's "done in" counts from dispatch, not from when Kinas first noticed it. A ship lane Firstmate parks while its PR
waits for a review reads **in review** instead of paused, so you can tell resting from stuck. A held question in the
Inbox names the PR it is about and opens it. The Crew page says how many lanes are free and, when dispatch is held,
why. Settings → Crew shows which of Firstmate's options are on; to turn one on, ask the first mate.

## 2. Business rules (invariants — never violate)

### The pin and the boundary

1. **The pin moves to `427056c4181c41074ad24f051f79919330df0fa5` (2026-11-12), reviewed monthly as before.** It moves
   further only by the same review: every key Kinas reads still present and typed the same, every script Kinas runs
   still changing nothing beyond what rule 3 accepts. Following Firstmate's `main` unpinned was offered and declined
   (ADR 0012).
2. **Claude Code stays the harness, and the captain's subscription stays theirs.** The launcher starts only `claude`,
   the official, unmodified binary, signed in through Anthropic's own flow. Kinas never reads, copies, passes or
   stores a Claude credential, never reads under `~/.claude` (first mate rule 9), and never sets up or suggests
   Firstmate's option to spread workers across several Claude accounts (#8121). Anthropic's usage policy of 12 November
   2026 forbids using multiple accounts to get around limits. Which harness a worker uses stays Firstmate's choice,
   shown per card as today.
3. **The snapshot's own latch is Firstmate's write, not Kinas's.** At the new pin, `fm-fleet-snapshot.sh --json`, for
   a task of a `local-only` project whose finished work Firstmate accepts, records the head that will land
   (`local_done_head` in that task's metadata), under Firstmate's own locks, taken without waiting. Kinas accepts this
   as part of the snapshot contract, the same call Firstmate's own watcher makes. Kinas's own code still opens nothing
   for writing under the home (first mate rule 4). A new decision record supersedes ADR 0019 and says exactly this.
   *(The captain's answer 1, 2026-11-15; the other routes are in §7.)*
4. **Kinas runs four Firstmate scripts, all asking only:** the snapshot (rule 3), `fm-afk-contract.sh field <name>`,
   `fm-project-mode.sh <name>`, and now `fm-capacity.sh --json` (rule 12). Every other rule 5 of the first mate stands:
   never `fm-send.sh`, never a script that spawns, tears down, holds, parks or answers.
5. **Firstmate's options are the captain's to turn on, in the first mate's chat.** Park on review, the fleet ledger
   and the lane cap are off until a file under Firstmate's `config/` turns them on. Kinas never writes one. It checks
   only whether each exists, says in Settings which are on, and shows a feature's facts once Firstmate publishes them.
   *(The captain's answer 3.)*

### What the crew pages gain

6. **The branch is shown where Firstmate names it.** The snapshot now carries each task's branch. The task detail shows
   it on the line under the state; the card does not. A task with no branch shows nothing there. (The first mate's
   rule 8 said there is no branch in the contracts; there is now.)
7. **In review is its own word.** A task whose current state Firstmate reports as paused *by park on review* reads
   **in review**, with Firstmate's line verbatim in the detail (`parked on review: PR https://github.com/…/pull/12 at
   4f2a9c1e8b3d since 2026-11-15T14:02Z; agent stopped, relaunches on review activity`, or `parking on review: …`
   while the stop is unconfirmed).
   It takes paused's place in the order: gone, done, failed, needs decision, blocked, **in review**, paused, ready, CI
   red, PR open, working, queued, unknown. A parked lane whose relaunch failed is reported blocked, and reads blocked.
   In review is in flight in the lane's header, and counts in Overnight as waiting on a person, next to ready. It is
   not in the waiting count (rule 10). The old word "parked" — a backlog state that means waiting on the captain —
   still reads needs decision.
8. **A held question names its PR.** When the snapshot's owned contributions name a PR for a task the captain holds,
   that task's Inbox item, its compact form on Home and its detail show `PR #12` and **Open the PR**, which opens the
   URL in the browser. The URL must be `https://` and is never logged. A contribution row adds no item and no count
   of its own: Firstmate marks a PR as the captain's only when it holds the task, and the held item is already
   there. *(This is what "PRs that need you" turned out to be in Firstmate's contract; see §7.)*
9. **A hold's question is shown as written.** Firstmate now keeps the hold's whole question, line breaks included. The
   Inbox and the detail show its lines as lines, capped at 2,000 characters, as rule 6's text is.
10. **The waiting count does not change.** It is still the open keyed decisions plus the captain-held tasks (first mate
    rule 16). In review, a held task's PR and free lanes add nothing to it.
11. **What moved inside a word is Firstmate's.** At the new pin a cancelled `no-mistakes` run reads unknown, not
    failed, and a finished ship whose work exists only in the worker's copy reads blocked. Kinas follows the snapshot
    and adds no rule of its own.

### Free lanes

12. **Free lanes are read only when the captain set a lane cap, and never through `quota-axi`.** Kinas runs
    `fm-capacity.sh --json` only while Firstmate's `config/lane-capacity` exists and does not name a `quota-provider`.
    That file is read only to find that one key. When it names one, the script would run `quota-axi`, which Kinas
    never runs (first mate rule 9), so Kinas does not run it, and Settings says why. The script runs on the snapshot's
    cadence, never twice within 5 s, under a 10 s limit, with the first mate's process rules (rule 29 there).
13. **What free lanes say.** With a valid cap: the Crew page's caption reads `2 of 4 lanes free`, and while Firstmate's
    verdict holds dispatch, `dispatch held · <reasons>` in Firstmate's own words (`memory`, `load`, `disk`, `cap`, …),
    in `--warn`. Usage's Crew section gains a row `Lanes · 2 of 4 in use` with its inline bar. Without a cap, or when
    the script is not run, neither appears. A failed read keeps the last good reading, stale by the page's rule
    (ADR 0004).

### The fleet ledger

14. **The ledger is read only while it exists, and only four of its events are kept.** Kinas reads
    `state/fleet-ledger.jsonl` while it exists (the captain turns it on). From it Kinas keeps `task.dispatched` (time,
    kind, harness), `task.pr_ready` (time, PR), `task.merged` (time, `pr` or `local`, PR) and `task.cleaned_up`
    (time). A `task.status` record is skipped without keeping a field: the snapshot already gives the task's last
    line. Unknown events and members are ignored. A record whose `v` is not `1` is refused with one line, and times
    fall back to Kinas's own readings.
15. **Read once, kept once.** Kinas reads only what was appended since its last read, keeps each event once (task,
    event, time and PR identify it), and leaves an unfinished last line for the next read. A ledger shorter than what
    Kinas has read was emptied, so it is read again from the start, and nothing is kept twice. What Kinas has kept, it
    keeps: the mirror never deletes (first mate rule 12).
16. **Real times, where the ledger has them.** With a task's `task.dispatched` kept, its card's elapsed time counts
    from dispatch (`working 12 min`). `done in 41 min` runs from dispatch to `task.merged`, or, with no merge record,
    to when the snapshot first said done. Without the ledger, the card counts from when Kinas first saw the task
    working, as today. The detail's timeline shows the four events at their own times, once each: `dispatched ·
    claude`, `PR #12 ready`, `merged · PR #12` or `landed locally`, `cleaned up`.
17. **A merged task that left the snapshot is done, not gone.** A task the snapshot stopped listing whose ledger
    records `task.merged` reads **done**. It is finished, and clears as done work does
    (`tasks/crew-done-clears/prd.md`). Overnight counts the ledger's events at their own times, so work merged and
    torn down while Kinas was closed is counted done, in its window.

### Install, and nothing leaks

18. **Setup moves a home to the new pin only when it is safe to.** `kinas crew setup` clones at the new pin as today.
    A home at the old pin, or at any commit before the new one, is fast-forwarded to it after a y/N. It is refused
    with one line and left untouched when it has local changes, is not on `main`, is ahead of the new pin, or a first
    mate runs in it (Herdr says `claude` is the `firstmate` workspace's foreground program). Firstmate's ignored
    `data/`, `state/`, `config/` and `projects/` are never touched by the move. Setup checks `perl`, which the snapshot
    now needs, as a prerequisite, and pins the optional `lavish-axi` at or above Firstmate's new floor, 0.1.80.
19. **Nothing new reaches the log or `kinas crew status --json`.** No branch, no PR URL, no ledger record, no reason
    from the capacity verdict, no hold question. The status JSON may gain counts (free lanes, in review) and nothing
    else. Every new fixture carries the forbidden-strings marker (first mate rule 26).
20. **No test and no probe touches Herdr's `default` session, the captain's own Firstmate clone, or `claude`.** As
    before (first mate rules 28 and 10).

## 3. Flows

**Moving the pin.** The build begins with the probe (slice 0). Firstmate at `427056c` runs in a throwaway Herdr session
with `HERDR_SESSION` set, on this Mac's Herdr 0.9.0, with the ledger turned on in the probe's home. A first mate on
`claude` files one ship task on a scratch repository in `local-only` mode. A worker spawns, finishes and is torn down.
Kinas's parser reads every snapshot taken along the way, `fm-capacity.sh --json` runs with and without a lane cap, and
the ledger is read. If Firstmate refuses Herdr 0.9.0, the build stops and the captain decides on Herdr's upgrade. If a
key Kinas reads moved, the build stops and the review is redone.

**Updating this Mac.** No Kinas or Firstmate home is installed here today (2026-11-15). After the ship point: build,
install (the captain's step, because it quits a running Kinas), `kinas crew setup`, launch. On a Mac whose home sits at
the old pin, setup offers the fast-forward of rule 18. Or the captain asks the first mate for `/updatefirstmate`: the
home then sits past the pin, and Settings says `moved from 427056c`, as today.

**Turning an option on.** In the first mate's pane: "turn on park on review", "turn on the fleet ledger", "cap lanes at
4". Firstmate writes its own config. At Kinas's next reading, Settings shows the option on and the pages show its
facts. Turning one off reverses it, and what Kinas kept from the ledger stays.

**A ship lane parked on review.** The worker opens its PR and finishes; Firstmate parks the lane until a human reviews.
The card reads **in review** with its PR badge, the detail shows Firstmate's line, and Overnight counts it waiting on
a person. The review lands, Firstmate unparks the lane, and the word follows the snapshot.

**A held question about a PR.** Firstmate holds a task for the captain; its contributions name the PR. The Inbox item
shows the question in its lines, `PR #12` and **Open the PR** beside Deny / Answer / Approve. Open the PR opens the
browser, and the answer still goes on the clipboard for the first mate's chat (ADR 0017).

**Free lanes.** With a cap of 4 and two lanes running, the caption reads `2 of 4 lanes free`. Memory runs low, so
Firstmate's verdict holds dispatch and the caption reads `0 of 4 lanes free · dispatch held · memory`. The captain sets
a `quota-provider`: the caption's lane part goes, and Settings says `Lane capacity: checks quota — Kinas does not run
it`.

**A night with the ledger on.** Three tasks are dispatched at 23:10, one merges at 01:40 and is cleaned up at 01:41,
and Kinas is closed all night. In the morning Overnight counts it done, from the ledger. Its detail shows `dispatched ·
claude 23:10 … merged · PR #31 01:40 · cleaned up 01:41`, and its card, until cleared, `done in 2 h 30 min`.

**A ledger that misbehaves.** A half-written last line is read on the next pass. Duplicates are kept once. The captain
empties the file: Kinas reads it from the start and keeps nothing twice. A `v:2` record: one line under the board,
`Fleet ledger: unsupported record version 2 · times from Kinas's own readings`.

## 4. Surfaces

Every surface composes DESIGN.md §4 components. DESIGN.md gains version **1.11** with this PRD, before the code: the
status badge's **in review** (ring, `--meter`) and its place in the order, Overnight's waiting group taking it, the
Timeline's four ledger entries, an InboxItem's PR line with **Open the PR**, the Crew page's lanes caption, Usage's
Lanes row, and Settings → Crew's options table. No new key binding; `keymap.md` is unchanged.

- **Crew page.** Cards as today, with **in review** (StatusBadge) where rule 7 says. Elapsed per rule 16. The Fleet
  section's caption (SectionHeader) reads `as of 09:31:12 · 2 of 4 lanes free`, and while dispatch is held,
  `· dispatch held · memory, load` in `--warn`.
- **Task detail.** Under the state line: `branch fm/stock-webhook` (mono, `--ink-2`). The PR section of a held task
  shows `PR #12` and **Open the PR**. The Timeline gains the ledger's four entries: dispatched (solid `--meter`), PR
  ready (ring `--ok`), merged or landed locally (solid `--ok`), cleaned up (cross `--ink-3`).
- **Inbox.** Held for you: the question in its own lines, then a quiet line `Held for you · <title> · PR #12 · <age>`,
  and **Open the PR** (Button, text) before Deny / Answer / Approve. Decisions and Reconcile are unchanged.
- **Home.** Overnight's rows count in review as waiting on a person and use the ledger's times (rules 7, 17). Waiting
  on you's compact items show `PR #12` in their quiet line; Open the PR stays on the Inbox.
- **Usage.** The Crew section gains `Lanes · 2 of 4 in use` (MetricRow with its inline bar) while free lanes are read
  (rule 13).
- **Settings → Crew.** `Firstmate 427056c (pinned)`, or `— moved from 427056c`. A **Firstmate options** table (Table,
  HealthBadge words): Park on review `on` / `off`; Fleet ledger `on` / `off`; Lane capacity `cap 4` / `off` /
  `checks quota — Kinas does not run it`. Under it, one line: `Turn these on or off by asking the first mate.` The
  tools table gains `perl`, and `lavish-axi` reads against the new floor.
- **CLI.** `kinas crew setup`: the pin and the fast-forward step of rule 18, and `perl`. `kinas crew status [--json]`:
  `in review` among the words, and `lanes_free` / `lanes_cap` when read. Nothing else (rule 19).

**Screens:**
- `mockups/fleet-board.html` — the Crew page with an in-review card, real times and the lanes caption, then with
  dispatch held, and Usage's Lanes row
- `mockups/task-detail.html` — a merged ship's detail with its branch and the ledger's timeline, and a held task's
  detail with its PR
- `mockups/inbox.html` — Held for you with a multi-line question and its PR, beside an open decision
- `mockups/settings-crew.html` — the Crew card at the new pin with the options table in its three states

## 5. Validation

Each case runs against the fake home in a throwaway Herdr session unless it says otherwise. Every one also passes the
first mate's privacy check (its AC-10), extended to the new fields.

- **AC-1 · The probe at the new pin** (real Firstmate, a throwaway session, `HERDR_SESSION` set). On Herdr 0.9.0 a
  first mate on `claude` spawns one `local-only` ship worker on a scratch repository; it finishes, lands and is torn
  down; every snapshot along the way parses with no error and no unknown word. The worker's harness reads `claude`.
  `fm-capacity.sh --json` reports `cap.status: none` with no cap and a verdict with a cap of 2. The ledger holds the
  task's four kept events. Herdr's `default` session and every `claude` outside the probe are unchanged before and
  after.
- **AC-2 · The contract.** A synthetic snapshot built to the new pin's shape, with every key Kinas reads plus
  `branch`, `contributions` and a base64-decoded multi-line `hold_reason`, parses to the same facts the old fixture
  did, plus the new ones. A snapshot of `fm-fleet-snapshot.v2` is still refused (first mate AC-13).
- **AC-3 · In review.** A task with state `paused` from source `review-park` reads **in review**, its detail shows
  Firstmate's line verbatim, its lane counts it in flight, and Overnight counts it waiting on a person. The same task
  with state `blocked` reads blocked. A backlog record `parked` still reads needs decision. The waiting count is
  unchanged throughout.
- **AC-4 · Branch.** The detail shows `branch fm/…`. The card does not, and neither does the log nor the status JSON.
- **AC-5 · A held question's PR.** A held task with a contribution row: the Inbox item shows its question's three
  lines and `PR #12`. Open the PR logs the open under `KINAS_E2E_NO_OPEN` with the URL. Approve still copies exactly
  `On <id>: Approved — go ahead.`, and the count is the same with and without the contribution row. A row for a task
  that is not held adds nothing. An `http://` URL shows no Open the PR.
- **AC-6 · Free lanes.** No `config/lane-capacity`: the capacity script is not run (the stub records its calls) and
  nothing is shown. A cap of 4 with two lanes: `2 of 4 lanes free` and `Lanes · 2 of 4 in use`. A verdict with
  reasons `memory`, `load`: `0 of 4 lanes free · dispatch held · memory, load`. A file naming `quota-provider`: the
  script is not run, and Settings reads `checks quota — Kinas does not run it`. A script that fails: the last reading
  stays, stale.
- **AC-7 · The ledger.** A fixture ledger contains, for one task, dispatched, two status records carrying a marker,
  `pr_ready`, `merged` and `cleaned_up`, plus one duplicate of each, a half line at the end and one `v:2` record. The
  card reads `done in` from dispatched to merged. The timeline holds the four entries once each. The marker is
  nowhere in the store, the log or the status JSON. Completing the half line adds one event, once. Emptying the file
  and appending one record keeps nothing twice. The `v:2` record shows its one line. A task dropped from the snapshot
  with `merged` reads done; one without reads gone.
- **AC-8 · The boundary.** The guard test allows exactly four script names, and its negative control still fails on a
  fifth. No code path opens a file under the home for writing. An inventory of the fake home is unchanged after every
  case, except what the snapshot stub itself writes (as Firstmate's would). No new path under `<home>/bin/` is built
  outside `crew/firstmate.rs`.
- **AC-9 · Setup.** `--dry-run` prints the new pin and `perl`. `--yes` over stubs leaves a fresh home at `427056c`. A
  home at `f9f74a1` on `main`, clean, is fast-forwarded to `427056c` with its ignored folders byte-identical. A home
  with a local change, on another branch, ahead of the pin, or with a first mate running (stub Herdr) is refused with
  its one line and left unchanged.
- **AC-10 · Nothing that worked broke.** `bun run check` green. The full end-to-end suite passes, run alone, including
  every first mate, crew marks and done work clears case. Every deliberate change to an existing test is named in the
  PR (the word order, Settings' recorded screens).
- **AC-11 · It ships clean.** `bun run check` and the full suite green on the commit that lands. The release holds none
  of the test seams. Installing it and the first real launch at the new pin are the captain's, and are listed under
  "Needs the captain".
- **Needs the captain's eyes:** install the release, run `kinas crew setup`, launch the first mate, turn on the ledger
  and park on review by asking it, and watch one real task go from dispatch to merge on the Crew page.

## 6. Out of scope

- **Following Firstmate's `main` unpinned** — declined (rule 1, ADR 0012).
- **Any first-mate harness but Claude Code; Firstmate's per-task Claude account rotation** — Claude stays (rule 2), and
  the rotation sits badly with the usage policy.
- **Turning Firstmate's options on from Kinas** — the captain asks the first mate (rule 5).
- **PR health (`state/pr-health.json`), forge-settled holds, record hygiene, OSC 7501 worker status** — none is a
  reader contract Kinas can read without a write, a lock or a network call, or each shows nothing the snapshot does
  not.
- **A list of PRs waiting on a reviewer** — Firstmate publishes only their count, so nothing is drawn (first mate rule 8);
  park on review's in-review cards are where such PRs show.
- **The ledger's status lines** — the snapshot already gives the last one (rule 14).
- **Second mates, Relay, the `hc`, herdr-app, T3 Code, Orca and other backends** — as in the first mate.
- **Upgrading Herdr** — the captain's, only if the probe needs it.
- **Recreating Build 3's private documents** (`architecture.md`, `build-spec.md`, `tasks.md`, the mockup generator,
  the first review). They are no longer on this Mac (§7); this feature's Gate 2 reads the code instead.

## 7. Open questions

1. **The badge word for a parked lane.** Proposed **in review** (ring, `--meter`): it waits on a person, like PR open.
   "parked" was set aside because Kinas already reads Firstmate's backlog state "parked" as needs decision. The
   captain decides at this gate.
2. **Free lanes in two places.** Proposed: the Crew page's caption *and* Usage's Lanes row. Usage is where Kinas says
   what this machine is doing, and the Crew page is where dispatch is watched. Either can go.

### Asked and answered, 2026-11-15

*The ask:* "FirstMate has new updates and also Claude now allows us to directly use FirstMate and third-party
applications. Verify here and then, if possible, simply adopt FirstMate entirely and we keep Claude as the main coding
agent for Kinas."

*The reading* (kept privately in `tasks/first-mate/review-2026-11-15.md`):
- **Firstmate at `427056c`:** 495 commits past the pin; `fm-fleet-snapshot.v1` still, every key Kinas reads present
  and typed the same; no channel for the captain's answers but the chat (ADR 0017 stands); the snapshot's new
  `local-only` latch (rule 3).
- **Claude:** Anthropic's Claude Code legal and compliance page allows a user to sign in to the unmodified binary with
  their own subscription, and forbids third-party developers from offering claude.ai login or routing requests
  through plan credentials. The Agent SDK help article (15 June and 7 October 2026) says plan use, `claude -p` and
  third-party apps still draw on subscription limits, and adds monthly API credits on Max, Ultra and Team for use with
  a Console API key. The usage policy effective 12 November 2026 forbids reselling, proxying, misrepresenting the
  client, and multiple accounts used to get around limits. Kinas already does exactly the allowed thing: the first mate
  and its workers are the captain's own signed-in `claude`. Nothing Kinas relied on changed.

*The captain's answers:*
1. *What does "adopt entirely" mean?* **Move the pin and use the new features** — over: move the pin only; follow
   `main` unpinned; drop the bridge and use Firstmate in the pane alone.
2. *The snapshot's new write?* **A — accept it as Firstmate's own, with a new decision record** — over: pin to the
   commit before it (2026-10-28); stop the snapshot while a project is `local-only`; ask upstream for a read-only flag
   first.
3. *Which new facts?* **All four offered:** parked on review, PRs that need you, free lanes, real times from the
   ledger. The branch comes with the pin regardless.
4. *Who turns Firstmate's options on?* **The captain, in the first mate's chat** — over: `kinas crew setup` writes the
   config files.
5. *Which lands first?* **`feat/review-session-code-bugs`**, then this is built on it.

*A correction to answer 3, made in writing this:* "PRs that need you" was offered as PRs flagged for the captain's
action, such as review threads, conflicts and approvals. In Firstmate's contract, a PR is the captain's only when the
captain holds its task. Conflicts, failing checks and review threads are the crew's to fix, and PRs awaiting a
reviewer appear only as a count. So the feature is rule 8, a held question naming its PR, plus in review on the board.
It is not a new Inbox group, and it does not change the count.

*Found in writing this:* Build 3's private documents named in `tasks/first-mate/status.md` — `architecture.md`,
`build-spec.md`, `tasks.md`, `review-2026-09-23.md`, `plan-2026-09-23.md`, `build_mockups.py` — are not in the main
checkout, the other worktree, or anywhere Spotlight finds. If the captain has a copy, Gate 2 would use it.
