# The factory in the cloud — Implementation Spec

*2026-11-16. Written from the captain's ask and their eight answers (§7), after a read of the code at `a8ddbc9` and
of Herdr, Firstmate and Anthropic's terms as they stand today. It changes where every agent runs and adds two places
to watch them from — the phone and a Factory page. Every rule of the first mate (`tasks/first-mate/prd.md`) and of
Firstmate, current (`tasks/crew-firstmate-current/prd.md`) stands, except the one this spec replaces on purpose: an
answer now reaches the first mate through Firstmate's own answer channel instead of the clipboard (rules 16–17).*

## 1. Objective

Today every agent the captain uses runs on the Mac: their own Claude Code and Pi sessions in Herdr's `default`
session, and the crew — Firstmate's first mate and its workers. When the Mac sleeps, the crew stops; when the captain
is away from it, a question the first mate holds waits until they are back. This change moves every agent session to
one Linux VPS the captain rents, and makes Kinas the factory's dashboard in two places: on the Mac, where the Work page
becomes a terminal into the VPS and every crew page reads the VPS, and on the phone, a private Kinas web page that
shows what waits, the crew and the factory's numbers, notifies when the first mate needs the captain, and sends the
answer back. A Factory page, on the Mac and the phone, measures the factory from what it already records: how many
tasks merged, how long they took from dispatch to merge, how long they waited on the captain, and how often they
went red. Claude Code stays the harness, signed in on the VPS with the captain's own subscription.

**Success metric.** The median time a question waits on the captain — from when Kinas first sees the first mate hold
a task or open a decision, to when the answer reaches the first mate — between 09:00 and 21:00 Lisbon time, measured
by the Factory page's own "Waiting on you" over two weeks. Today it has no record and is bounded by when the captain
is at the Mac. Target: under 30 minutes. Read beside it: the share of merged tasks dispatched and merged while no Kinas
window on the Mac had focus — the work the cloud did that the Mac could not.

## Announcement

Your agents now run on your VPS, not your Mac. Close the lid and the crew keeps working; open it and the Work page is
the same Herdr session you left, on the VPS. When the first mate needs you, your phone tells you — the project and the
question — and you can approve, deny or answer right there, and the first mate carries on. The new Factory page shows
the week: what merged, how long it took from dispatch to merge, how long things waited on you, and how often they went
red. Nothing estimates or guesses: every number comes from what the crew recorded. Your code stays on the VPS; the
phone sees titles, questions and numbers, never code.

## 2. Business rules (invariants — never violate)

### Where the work runs

1. **One VPS runs every agent.** With a VPS set, every agent session runs there: Herdr's `default` session with the
   captain's own Claude Code and Pi sessions, the first mate and its workers. The Mac runs Kinas only — no `claude`,
   no `pi`, no Herdr server of Kinas's starting. Without a VPS set, Kinas works on the Mac exactly as today. Kinas
   shows one place at a time; switching moves nothing, and sessions on the other side keep running, unshown.
2. **The captain rents the VPS; Kinas never buys, sizes, rebuilds or deletes one.** Kinas connects with the captain's
   own SSH setup — their key, their agent — and holds no key of its own (ADR 0006). The Hostinger reader stays
   read-only (ADR 0008). Kinas installs software on the VPS only item by item, after a yes, as `kinas crew setup` does
   on the Mac, and only as the captain's user, never as root.
3. **The captain's own subscription, on the official binary, signed in by the captain.** On the VPS `claude` is the
   official, unmodified binary, signed in by the captain through Anthropic's own flow, with one account. Kinas never
   reads, copies, stores or passes a Claude credential and never sets an API key. It checks only whether
   `ANTHROPIC_API_KEY` is set in the VPS's login environment — its presence, never its value — and if it is, says so
   in red: every run would be billed to the API instead of the plan. Nobody else's work runs on the VPS. (Anthropic's
   legal page lets an end user sign in to the unmodified binary with their own subscription and forbids routing
   requests through plan credentials on behalf of others; its usage policy forbids several accounts to get around
   limits. §7 has the reading.)
4. **Kinas's own build stays on a Mac.** Agents on the VPS may work on Kinas and run its unit tests. Its end-to-end
   suite and its release build need macOS and stay on the Mac, run by the captain (§6).
5. **Code stays on the VPS.** The client repositories' working copies live on the VPS. Nothing this feature adds
   copies code, diffs, briefs, reports, transcripts or file paths off the VPS — to the phone, the store or the log.
   The Mac's Files and reader keep reading the Mac's own folders, as today; the VPS's working copies are seen through
   their tasks (word, PR, checks, timeline) and through the terminal.

### What the Mac shows

6. **The Work page is the VPS's `default` session.** With a VPS set, the terminal attaches Herdr's `default` session
   on the VPS. Sleeping, closing or losing the network detaches the terminal; nothing on the VPS stops. On return it
   reattaches by itself. While detached the terminal's chrome says `reconnecting`, or `unreachable since 14:02` after
   a minute, and the last screen stays, dimmed. **Open in the terminal** on a Mac folder opens a workspace on the VPS
   in the folder of the same name under the VPS's projects folder, or says it is not there.
7. **The crew pages read the VPS, unchanged.** Crew, Inbox, Home and Usage read the crew on the VPS by the same rules
   as on the Mac today: the same four read-only Firstmate scripts, the same fleet ledger, the same words, counts and
   cadence. Launch the first mate starts it on the VPS. A failed read keeps the last good reading, stale by the page's
   rule (ADR 0004), and the sidebar's machine line says `unreachable`, with since when on hover.
8. **Usage reads the VPS.** The Claude plan gauge comes from the statusline on the VPS, where Claude Code now runs;
   tokens by model are counted from the transcripts on the VPS, and only the numbers cross; the host section shows the
   VPS's CPU, memory and disk beside the Mac's. A transcript's text never leaves the VPS.
9. **Sessions on the VPS start with the context packet.** `kinas context --agent` runs on the VPS for the sessions
   there, from the same session hook as on the Mac, built from the VPS's projects folder and the crew.

### Kinas on the VPS

10. **A small part of Kinas runs on the VPS, always.** So the phone works while the Mac is closed, the VPS runs Kinas's
    companion as the captain's user. It starts with the machine and restarts when it stops. It reads the crew by rule
    7, sends the phone's summary to the store (rule 13), notifies (rule 15) and delivers answers (rule 16). It runs no
    agent, opens no session and types into no pane (ADR 0003). When it is not running, the Mac says so in one line,
    and the phone shows when it last heard from it.
11. **The Mac and the phone tell the same story.** The same tasks, words and counts, and the same waiting count (the
    first mate's rule 16), each shown with the time of the reading it came from.

### The phone

12. **The phone is a private Kinas web page on the home screen, for the captain only.** A phone is paired from the
    Mac: Settings shows a one-time code, as a QR code and as text, that works once and for 10 minutes. A paired phone
    is listed with its name and when it was last seen, and **Remove** unpairs it at once. Nothing is reachable without
    a pairing; there is no account and no password.
13. **What leaves the VPS, and only that.** Task titles, project names, words, PR numbers and check counts; a held
    question's text (capped at 2,000 characters, as on the Mac) and its recommendation; the timeline's event names and
    times; the factory's numbers; usage percentages and the VPS's health. Never code, diffs, briefs, reports,
    transcripts, file paths, branch names, logs, keys or tokens. It is held in a store Miraside owns, in the EU. The
    current reading is replaced at each cycle; what the factory needs for its weeks is kept (rule 21).
14. **What the phone shows.** Four tabs: **Home** (Overnight and Waiting on you, compact), **Inbox** (with its count),
    **Crew** (the board as one list per project) and **Factory** (rule 19). It has no terminal, reader, usage detail or
    settings (DESIGN.md 3.3). DESIGN.md's Launch tab is not built here (§6): starting work from the phone is a second
    way to write to the first mate, and waits for its own decision.
15. **One notification for each thing that waits on the captain.** When the first mate holds a task for the captain
    or opens a keyed decision, the phone gets one notification within 60 s of the reading that shows it: the project
    and the question's first line, at most 120 characters — `shop · Keep the CSV import for one release?`. A tap
    opens that item. One more kind: the VPS unreachable for 10 minutes (`Kinas can't reach the VPS since 14:02`), and
    its return. Nothing else notifies — not working, done, merged, CI red or blocked; those are on the board. No
    notification repeats. The phone's Focus decides when it rings.

### Answering

16. **An answer reaches the first mate through Firstmate's own answer channel.** Approve, Deny and Answer — on the
    phone, and on the Mac while a VPS is set — deliver the same words the Inbox puts on the clipboard today (`On
    stock-webhook: Approved — go ahead.`) into the channel Firstmate keeps for answers from its other channels. This is
    the first thing Kinas writes into Firstmate. A new decision record supersedes ADR 0017 and amends ADR 0020 for
    exactly this, and nothing else: Kinas still never dispatches, sends orders, releases, parks, tears down or types
    into a pane. Without a VPS, the Mac answers by the clipboard as today.
17. **An answer is delivered once, or refused with the reason.** An answer is for one open question. If the question
    was answered first somewhere else — the Mac, the first mate's chat — or is no longer open, nothing is sent and the
    item says `already answered at 14:05` or `no longer waiting`. A double tap sends one answer. A delivered answer
    shows on its item as `answered from the phone at 14:05` and in the task's timeline. When the VPS cannot be reached,
    the answer is not queued: the phone says it was not delivered and keeps the text for another try. What Firstmate
    refuses — a release while the captain is away — is shown in Firstmate's own words.

### The factory

18. **Every number comes from what was recorded, and nothing is spent to make one.** The sources are the fleet ledger
    (dispatched, PR ready, merged, cleaned up), Kinas's own readings of each task's word, the answers Kinas delivered
    and the usage counts. No number is estimated, sampled or judged, and no model is asked (§6). A number with fewer
    than three tasks behind it shows `—` and `n = 2`.
19. **What the Factory page measures**, for each week (Monday to Sunday, Lisbon time), for all projects and for each:
    - **Merged** — tasks whose `task.merged` falls in the week.
    - **Cycle time** — dispatch to merge for the week's merged tasks: the median and the 90th percentile.
    - **Waiting on you** — for each hold or keyed decision, from when Kinas first saw it to when its answer reached
      the first mate or Firstmate closed it: the median between 09:00 and 21:00, and the longest.
    - **Needed you** — the share of merged tasks held or needing a decision at least once.
    - **Went red** — the share of the week's finished tasks that were blocked, failed or CI red at least once.
    - **While you were away** — the share of merged tasks dispatched and merged while no Kinas window on the Mac had
      focus.
    - **Tokens per merged task** — the median of input plus output tokens in the transcripts of the task's workers.
    - **Claude plan** — the weekly window's highest reading in the week.
20. **The factory needs the fleet ledger.** Without Firstmate's ledger on, the Factory page says `Turn on the fleet
    ledger by asking the first mate` and shows nothing in its place. Weeks before the ledger was on have no numbers.
21. **The weeks are kept.** What the factory needs — each task's events and times, never its text beyond its title —
    is kept in the Mac's store and in the store, and nothing is deleted automatically (the first mate's rule 12).

## 3. Flows

**Setting up the VPS (once).** The captain rents a Linux VPS and can reach it with `ssh` and their key. In Settings →
**Where agents run** they add it: an SSH target and a label. Kinas checks the VPS and lists each item with its state:
reachable; the operating system; Herdr at Kinas's version, with its server running; Firstmate at the pin; the crew's
tools; Kinas's companion; Claude Code signed in; `gh` signed in; `ANTHROPIC_API_KEY` not set. Each missing piece Kinas
can install is offered with a yes/no, one at a time. Claude Code and `gh` are signed in by the captain in the VPS's
terminal (the Work page shows it); the list gives the command. Setup then offers to clone, one yes at a time, each
client folder of the Mac that has a GitHub origin into the VPS's projects folder. Failure: an unreachable VPS reads
`can't reach <label>: host key changed`, `… login refused` or `… timed out`; Kinas never shows a key or a path.

**Leaving the Mac.** Sessions in the Mac's own Herdr keep running there until the captain closes them; Kinas moves
nothing. Firstmate's home on the Mac is left as it is, and its tasks finish there or are filed again on the VPS by the
captain.

**A day.** The Mac is open: the Work page is the VPS's `default` session, the crew pages read the VPS, Usage shows the
VPS beside the Mac. The lid closes: the crew carries on. The first mate holds a task: within 60 s the phone notifies;
the captain opens it, reads the question and the recommendation, taps Approve; the answer reaches the first mate, the
item says `answered from the phone at 14:05`, and the card moves on at the next reading. The Mac opens later: the same
board, the answer in the task's timeline, the week's numbers on the Factory page.

**When something fails.** The VPS is unreachable: the Mac and the phone keep the last reading, marked stale, with
`unreachable since 14:02`; after 10 minutes the phone is notified once, and once more on return. The companion stops:
it restarts; if it cannot, the Mac says `Kinas on the VPS is not running` and the phone shows `last heard 14:02`. The
store cannot be reached: the companion keeps the latest reading and sends it when it can; the phone shows its time. An
answer is tapped while the VPS is unreachable: rule 17.

**Pairing a phone.** Settings → Where agents run → **Pair a phone** shows the code. The captain opens the phone page,
scans or types the code, and adds the page to the home screen; the phone asks once to allow notifications. The phone
is listed by name in Settings from then on.

## 4. Surfaces

- **Settings → Where agents run** (a new card at the top of the Crew group): This Mac or a VPS; the VPS's checks as a
  Table with status badges (the tool table's way); the phones paired, each with Remove; **Pair a phone**; **Send a test
  notification**.
- **The sidebar's machine line** (DESIGN.md 3.1, "one line for the VPS connection"): the VPS's label and `connected`,
  `reconnecting` or `unreachable`, with its dot; since when on hover.
- **Work**: the terminal chrome names the place — `vps · default · firstmate` — and its badge says `reconnecting` or
  `unreachable since 14:02` while detached.
- **Crew, Inbox, Home**: unchanged in what they show; with a VPS, the Inbox's actions deliver (the toast says `Sent to
  the first mate`), and an answered item reads `answered from the phone at 14:05`.
- **Usage**: the host section gains the VPS (CPU, memory, disk) beside the Mac.
- **Factory** (new page): a sidebar row after Usage and ⌘6 (`keymap.md` gains it first). A week picker, a row of the
  week's headline numbers (Merged, Cycle time, Waiting on you), then a Table by project, then each of rule 19's numbers
  for the last eight weeks as Metric rows.
- **The phone**: Pair, then four tabs — Home, Inbox, Crew, Factory — per DESIGN.md 3.3, with the iPhone type scale;
  an Inbox item opens a sheet with the question, the recommendation and Approve, Answer and Deny at the bottom; the
  notification.

**Screens** — one line per mockup:
- `mockups/settings-vps.html` — Settings → Where agents run: adding a VPS, its checks, the API key warning, pairing a phone.
- `mockups/work-vps.html` — the Work page on the VPS: attached, then reconnecting, with the sidebar's machine line.
- `mockups/factory.html` — the Factory page on the Mac: one week, by project, and eight weeks.
- `mockups/phone-home.html` — the phone: pairing, Home, and Crew.
- `mockups/phone-inbox.html` — the phone: the notification, the Inbox, answering, and an answer refused.
- `mockups/phone-factory.html` — the phone: the Factory tab.

## 5. Validation

1. **The probe (before any code).** On the captain's VPS: Herdr at Kinas's version as a headless server, Firstmate at
   the pin with one local-only project, a first mate and two workers on `claude`; 30 snapshots fetched over SSH and
   parsed by Kinas's own parser with 0 errors; a held question answered through Firstmate's answer channel and seen
   by the first mate; the Work page's paste reaches the first mate's pane through the remote attach.
2. **Lid closed for an hour** with two tasks in flight: both progress on the VPS; the Factory page, opened after, has
   their real dispatch and merge times.
3. **A held question end to end:** the phone's notification arrives within 60 s of the reading that shows the hold;
   Approve reaches the first mate within 60 s; a double tap delivers one answer; answering the same item from the Mac
   afterwards says `already answered at …`.
4. **Nothing private leaves the VPS:** a day of the store's contents, searched, has 0 matches for file paths
   (`/home/`), code (`diff --git`, `function `, `import `), branch names (`fm/`) and key patterns (`sk-ant-`, `ghp_`,
   `github_pat_`).
5. **The factory is right:** for one week, every number on the Factory page equals a count made by hand from the
   ledger and the answers.
6. **The API key check:** with `ANTHROPIC_API_KEY` exported in the VPS's login profile, Settings shows the red line
   within one reading; removed, it clears.
7. **The VPS unreachable** (its SSH blocked): the sidebar says so within two readings, the phone is notified once at
   10 minutes, the last readings stay, stale, and everything recovers by itself when it returns.
8. `bun run check` green; the e2e suite run alone on the Mac, green.

## 6. Out of scope

- **Scoring runs with an LLM judge, replaying past tasks as model benchmarks, and agents that change the factory
  themselves** (the talk's self-improvement loop): each spends subscription usage; this feature measures only from
  records.
- **Other people**: one captain, one VPS, one Claude account; no team access.
- **Kinas creating, sizing, paying for or deleting servers**: the captain rents the VPS.
- **Kinas's own e2e suite and release build on the VPS**: they need macOS.
- **Starting work from the phone** (DESIGN.md's Launch tab): a second way to write to the first mate.
- **Reading the VPS's files in the Mac's reader and Files, and the Changes view's crew marks** for workers on the VPS:
  a task's brief, report and changes say `on the VPS — open it in the terminal` instead.
- **Anthropic's cloud sessions, the Agent SDK and Managed Agents**: no way to watch the first, and the others bill per
  token (the analysis, option B and C).
- **A native iPhone app**, and carrying work in flight from the Mac's Firstmate to the VPS's.

## 7. Open questions

1. **Which VPS, and how big** — the captain's. Proposed: Ubuntu 24.04 LTS, 8 vCPU, 16 GB memory, 200 GB disk, for a
   crew of four on the client projects; the probe measures one task's peak, and Firstmate's lane cap keeps the crew
   inside it.
2. **The store** — Gate 2: a deployment Miraside owns in the EU, separate from the dashboard's.
3. **Keyed decisions** — whether Firstmate's answer channel takes an answer to a keyed decision as it does to a held
   task (the probe). If not, a decision is answered in the first mate's chat, and the phone says so on the item.
4. **Herdr's version** — Kinas pins 0.9.0; remote calls need 0.9.1 or later on both ends (current stable 0.9.5), and
   Firstmate verifies its pane parsing only on 0.9.0 (the probe).
5. **DESIGN.md's number** — `main` is at 1.12; the interface polish holds 1.11 on its branch. This feature's amendment
   takes the next free number when it is written.

**Asked before writing, and answered (2026-11-16):**
- Where should the agents run? → **On a VPS.** What moves? → **Also the interactive sessions.** The phone from the
  start? → **Yes, also the phone.** The factory numbers in this feature? → **Yes, part of the feature.**
- How should Kinas reach you on the phone? A home-screen web app · a native iPhone app · notifications only →
  **A home-screen web app.**
- How should a phone answer reach the first mate? Through Firstmate's own answer channel (Kinas writes for the first
  time) · the phone shows, the chat answers → **Through Firstmate's own answer channel.**
- What may leave the VPS? Summaries to a store · nothing (a private network) · everything → **Summaries to a store
  Miraside owns; code, diffs, briefs and transcripts never leave.**
- What is out? → **LLM-judge scoring and benchmark replays; other people; Kinas buying servers; Kinas's own e2e and
  release on the VPS.**

**Anthropic's terms, as read on 2026-11-16** (code.claude.com/docs/en/legal-and-compliance): OAuth "is designed to
support ordinary use of Claude Code"; Anthropic does not permit third-party developers "to route requests through
Free, Pro, Max, or Ultra plan credentials on behalf of their users", nor does it "prevent an end user from signing in
to the unmodified Claude Code binary with their own Claude subscription"; advertised limits "assume ordinary,
individual usage". No page speaks of a rented server or of unattended, concurrent sessions — the use Firstmate already
makes on the Mac. Rule 3 keeps it to one person, one account, the official binary and no API key.
