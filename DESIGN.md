# DESIGN.md · The Kinas design system

The law for how Kinas looks, the way `keymap.md` is the law for keys. An agent building any surface reads this first, uses only what it defines, and adds to it before using anything it does not define.

Version 1.14, 2026-11-24.

## Changes

- **1.14, 2026-11-24 (the factory in the cloud, `tasks/cloud-factory/prd.md`; each part lands with its slice; written 2026-11-17 as 1.13, renumbered when the interface polish landed first as 1.13, and fitted to its Settings rows and status bar).** Agents may run on a Linux machine you own or rent, called the VPS here. **Settings** gains a first section in the Crew group, **Where agents run**, as **Settings rows**: This Mac / VPS (two Buttons, the chosen one primary), the SSH target and the label, then wide rows: a Table of checks with status badges in the tool table's way (the machine's Herdr version beside the Mac's, in solid `--warn` when they differ; Install as a secondary Button on a missing row; the API-key row `set — every run would bill the API, not your plan` in solid `--danger`), the bootstrap command in mono with Copy, the Phones table with Remove, and **Pair a phone**, which shows the one-time code in `--text-xl` mono and the pairing link, each with Copy — no QR code (it would need a dependency; the Gate 1 mockup's QR is replaced by the link). **The status bar's VPS part** (3.1) names the agents' machine while the place is a VPS, in four states: `connected` (solid `--ok`), `reconnecting` (solid `--warn`), `unreachable` (solid `--danger`; since when in its tooltip) and `Kinas on the VPS is not running` (solid `--warn`). **Terminal chrome** (4) names the place first — `vps-1 · default · shop` — and while detached carries a badge `connecting`, `reconnecting` or `unreachable since 14:02`, the pane dimmed until it reattaches. **Inbox item** (4): with a VPS set, an answered item gains one quiet line — `answered from the phone at 14:05`, then `read by the first mate at 14:06` — and the first mate's reply on its own line; the toast says `Sent to the first mate`, or the refusal in `--danger`. **Usage**'s host section shows the VPS beside the Mac. A new page, **Factory** (5), after Usage, ⌘6: a title row with a week picker (text Buttons ‹ ›), a section with three figures, a Table by project and a Table of the last eight weeks; a figure is the **Gauge** without its bar (4, Gauge, variant *figure*: title, number and unit, one line of detail); a figure with fewer than three tasks behind it shows `—` and `n = 2` in its detail. *As built, slice 4 (2026-11-25):* the checks are a Table of three columns — Check, State (a `Dot` in the row's tone and its words: `--ok`, `--warn`, `--danger`, and a `--stale` ring for a row that waits on an earlier one) and the row's action, a secondary Button (`Install Herdr`, `Start under systemd`, `Add the rule`, `Set to auto`, …) or the captain's own command in mono with Copy; `Run Herdr under systemd` takes a second click, with the warning beside it in `--danger` words; the API-key row's words are `--danger` text when set. The bootstrap row shows while no companion answers: per architecture, the command in mono with Copy and its SHA-256 quiet beneath, or, until this version's Linux build is published, the two steps by hand. The client folders are a plain list, each its folder in mono, its `owner/repo` quiet and Clone, or `· cloned`. *As built, the answer path (2026-11-25, ADRs 0026–0027):* three more check rows. **Relay instruction** offers Install, which writes Kinas's file. **First mate's launch** turns `--warn` when a running first mate was started without the instruction: `launch it from the Work page`. **Workers sandboxed** is `--ok` when every worker runs under Kinas's policy. It is `--danger` with the task id and the reason (`fix-login: started outside Kinas's sandbox — no answers are sent until it ends`) when any worker doesn't. While that row is red, the inbox's Answer says the same words and sends nothing. Its Install, `Sandbox workers`, writes the wrapper. Then `Restart Herdr` takes a second click, with the warning beside it in `--danger` words: `closes every pane on the VPS: close what's open first`. **The review flag.** A crew card whose pull request or branch changes `.claude/` or `.mcp.json` carries one more line under its PR line, in `--danger` text at `--text-sm`: `touches .claude/ — review before merging` (or `.mcp.json`). The task detail's PR section lists those paths in mono. No new component: a line of text in the card's own grid. *As built, 4.14 (2026-11-25, ADR 0028):* **the worktree scan** adds a second line under it, the same `--danger` text at `--text-sm`, while the task's worktree holds a `.claude` or `.mcp.json` that isn't the repository's: `worktree holds .claude/ that isn't the repository's — review before landing` (or `.mcp.json`; both: `worktree holds .claude/ and .mcp.json that aren't the repository's — review before landing`), or `worktree could not be checked — review before landing`. The task detail lists those paths in mono under it, beside the PR's. No new component. **The iPhone** (3.3) is built as a home-screen web page with four tabs — Home, Inbox, Crew, Factory; the Launch tab waits for its own decision — and an item sheet with Approve, Answer and Deny stacked at the bottom, `--hit-touch` tall. No token is added.
- **1.13, 2026-11-17 (the interface polish, `tasks/interface-polish/prd.md`; written 2026-11-15 as 1.11, renumbered when Firstmate, current landed first as 1.12).** Kinas takes a reference app's look and reach without changing a flow, a key or a command. The dark theme turns neutral gray (2.3); the light theme does not change. Group labels and table headers are set in capitals, letter-spaced (2.5). Two text tokens, `--ok-ink` and `--danger-ink`, colour a changed file's line counts, the one other place a status colour is text (2.2). The window gains a **Status bar** along its foot, with the **Usage popover** (3.1, 4); the sidebar gains a search row, nav chords on point and each client folder's crew state with its tasks in flight, and gives its connection line to the status bar (3.1). The palette searches files, folders, tasks, inbox items, workspaces, settings and commands, in groups of **Palette rows** (4). Every list row leads with its name; an empty state is a line, not a box; `Kbd` takes a `--surface-2` fill (4). Home folds quiet folders into one line and stops repeating a gauge under Needs attention; Usage's chart spans its data; Settings gets a section list, a search and **Settings rows**; a changed file in a tree shows **Line counts** (4, 5). A reset reads relative within a day and absolute beyond (6).
- **1.12, 2026-11-16 (Firstmate, current, `tasks/crew-firstmate-current/prd.md`).** Kinas runs Firstmate `427056c` and shows what it publishes. A new crew word, **in review** — a ring in `--meter` — for a task Firstmate parked on review; it sits after blocked in the word order, counts in flight in its lane and as waiting on a person in Overnight, and adds nothing to the waiting count (4, Status badge; the catalogue's `review` story enters with the build's slice 2). The task detail gains a branch line, and a held task's PR and **Open the PR** (5, Crew). A held question keeps its line breaks wherever it is drawn as a question; a held Inbox item with a PR names it in its quiet line and has Open the PR before Deny (4, Inbox item). The Fleet caption gains free lanes and a held dispatch (5, Crew); Usage's Crew section gains a Lanes row (5, Usage); Settings → Crew gains `perl` among the prerequisites and a Firstmate options table (5, Settings). The ledger's four events join the timeline (4, Timeline). No token, key or component is added. (1.13 is the interface polish's, written on its own branch on 2026-11-15; whichever of the two reaches `main` second takes its number in order.)
- **1.10, 2026-09-29 (done work clears, `tasks/crew-done-clears/prd.md`).** Finished crew work — done or gone — leaves the Crew page's board and Home's Overnight at that page's next load, once the page has shown it; a done task whose PR is still open stays until the PR is merged or closed (5). Nothing new is drawn: no component, token or word changes.
- **1.9, 2026-09-28 (crew marks, `tasks/crew-marks/prd.md`).** A file tree also marks what the first mate's crew has changed in its own checkouts and not pushed: the **Change mark** gains a **crew** form, the same letter with a **hollow** dot (a ring of `--dot-ring`), drawn before the captain's own mark on a row that has both; folders gain a crew roll-up; a file the crew added that the captain's folder lacks gets a **crew row**, its name in `--ink-3`; the tree's head gains a second caption line (4). The **Diff** gains the crew's copy: a summary that says whose, read-only (4).
- **1.8, 2026-09-25 (tree changes clear on push, `tasks/tree-changes-push/prd.md`).** A Change mark goes by itself once its change is on the branch's remote, and text already there is never marked; ↻ clears only what is pushed or can never be pushed. A mark waiting for a push says so in its words, ", not pushed"; each mark says its own "since", and a roll-up and the caption the earliest (4 Change mark, Diff). Nothing about how a mark looks changes.
- **1.7, 2026-09-23 (the first mate's Gate 1, reopened by its slice 0 probe, `tasks/first-mate/prd.md` rules 5–7).** Firstmate takes a person's answer only in the first mate's chat, so a crew inbox item's actions put an answer line on the clipboard and go to the first mate's pane, where the person pastes it. The text box's button is Copy and go; the one state after an action is Copied, and the item stays until Firstmate closes it; Sending, Sent and Not delivered are gone, and so is the item that could not be answered from Kinas (4 Inbox item, 5 Home).
- **1.6, 2026-09-24 (tree changes, `tasks/tree-changes/prd.md`).** Every file tree marks what changed on disk since it was first shown: a **Change mark** (a status dot and a grey letter, A, M or D) at the end of a row, a roll-up (the dot and a count) on a folder with changes beneath it, deleted rows kept and struck through (4). The reader gains a **Diff**, its Changes view (4). Status colours gain one use, a faint tint behind a diff line, in the Diff only and always with its sign (2.2).
- **1.5, 2026-09-23 (the reader's layout, `tasks/reader-layout/prd.md`).** Part 1, the column and the text: Files and Contents are header buttons at every width — wide they hide and show their section beside the text, and the choice is remembered; narrow they open it over the text, as before (4 Reader header). The side column's right edge resizes it from 160 to 480 px, never leaving the text under 320, and a double-click puts it back to 220; prose fills the reader's width, with no 72ch cap, and the line at the top stays there when the width changes (5 Reader). Part 2, tabs: the Tab strip, one row above the reader's header holding every file opened this session (4 Tab strip); the sidebar loses Recent, since the tabs are the recent files (3.1). Part 3, the title bar: Kinas draws the window's own, one `--chrome-h` bar across the window above the columns, holding the traffic lights, a sidebar button and ← and →, which walk every place visited, pages and files alike; the reader's own Back goes, so there is one ← in the window (3.1, 4 Title bar, 4 Reader header).
- **1.4, 2026-09-23 (the first mate, written with its Gate 1 PRD, `tasks/first-mate/prd.md`).** Written to what Firstmate's contracts carry, read at its pin: a lane's header counts what runs instead of provider slots, which Firstmate does not publish, and a crew project is a client folder's lane by their shared GitHub repository (4 Lane); an inbox item shows evidence and a recommendation only when its source carries them, and gains the form for a held task answered in the first mate's pane (4 Inbox item); the status badge gains failed, paused, unknown and gone (4); the right panel holds one thing at a time (3.1); Home's "since" is defined on the Mac (5); the terminal chrome draws a badge only for a worker's pane (4); Settings groups its cards (5); the Work page's strip of lanes does not come with the crew (5).
- **1.3, 2026-09-23 (folder views).** The sidebar loses its Reader row: a click on a file opens the reader, and with no file the row had nothing to show. Settings moves to the sidebar's foot, and Recent sits under the client folders (3.1). A client folder can be hidden (off the sidebar and Home), removed (off Settings' list too, restorable, never touched on disk) or added from any folder inside the projects folder (3.1, 5). The reader's ▾ menu becomes the library's Menu, which the client folders' right-click menu uses too (4).
- **1.2, closed 2026-09-23.** Written down as built: the catalogue of components and their stories (4), the as-built notes on the gauge's reset, the metric row's missing bars, the terminal chrome, the reader header, Settings and the toast's placements (4), and each page as it shipped (5); the migration's status (10). `tokens.css` is named the source of truth in section 2's opening, and the brand's display face in 2.1 is Bricolage Grotesque, as 2.5 already said.
- **1.2, 2026-09-22 (the design system build).** The law meets the code. The terminal follows the theme: `--term-bg` and `--term-fg` take a light value too, and the sixteen ANSI colours have a set per theme (2.2, 2.3). The type scale is written as pairs, `--fs-*` / `--lh-*`, because that is what `font-size` and `line-height` take (2.5). Two sub-grid spacing steps, `--space-0` 2 and `--space-1h` 6, for gaps inside a component (2.6). The display face is Bricolage Grotesque (OFL): Clash Display's license does not allow the files in a public repository (2.5, the open item closed). `--panel-w` is the panel's default share and the divider decides, down to `--pane-min` (2.6). Section 9 gains "Adding a surface", the procedure every later build follows, and names `app/src/styles/tokens.css` as the source of truth until `tokens.json` is needed for the phone. The gauge thresholds in 2.2 (80 %, 95 % used) replace the app's earlier ≤ 25 / ≤ 10 % left.
- **1.1, 2026-09-22.** Scope set to an engineering tool for the team, with no agency pages. Added the Home page (overnight progress per client folder, plus usage), iPhone layouts for approving and launching, and a two-layer token model so the open-source build can swap accent and fonts. Added a categorical palette for folders and providers, layout tokens, and a complete dark theme. Fixed the contrast values that failed: `--stale`, `--warn`, and the dark `--accent-ink`. Removed the accent from gauge bars, removed the crew's use of `--warn`, and removed `--info`. Migration steps now end on a definition of done instead of a duration.
- **1.0.** First version.

## 1. What it should feel like

Kinas is a quiet instrument for the engineers who run a coding factory: the people, the crew of agents, and the client folders the agents work in. The references are the Claude and Codex desktop apps and Linear. Warm neutrals, one accent, generous space, type that carries the hierarchy, and color reserved for meaning. On every screen there is one thing to look at first. Nothing is decorative, and nothing shouts unless something is wrong.

Scope: engineering only. Kinas shows what the agents did, what is waiting on a person, what the tools cost, and the state of the machines. Sales, calls, and billing live elsewhere.

Five principles, in order:

1. **Four color roles, never mixed.** Neutrals measure: surfaces, text, and the fill of any bar that is fine. The accent means interactive or selected. Status means state. Category means identity (which folder, which provider). A color from one role never does another role's job.
2. **Hierarchy by type, not by boxes.** Three text sizes and two weights make a page legible before any border or fill. Cards exist to group, not to decorate.
3. **One thing first.** Every page has a hero. On Home it is the overnight progress; on Usage, the three gauges that decide the day.
4. **Say when, once.** A reading's freshness is shown once per section, in small quiet text. The only exception is a reading that has gone stale, which says so where it is.
5. **Keyboard first on the Mac, thumb first on the phone.** Every Mac action has a key in `keymap.md` and is reachable by Tab. Every phone action is within reach of a thumb.

## 2. Tokens

Tokens come in two layers. The source of truth is `app/src/styles/tokens.css` (amended 1.2), and `app/src/styles/design.test.ts` holds it to the values written in this section, in both themes; `design/tokens.json` and a generator arrive with the phone's `KinasTokens.swift` (section 3.3). Components use semantic tokens only. A raw hex, raw pixel size, or raw spacing value in a component is a build failure (section 9).

### 2.1 Brand layer (the only overridable layer)

```
--brand-accent        #00549E
--brand-font-ui       "Inter"
--brand-font-mono     "JetBrains Mono"
--brand-font-display  "Bricolage Grotesque"   (amended 1.2; see 2.5)
```

Everything below derives from these four or is fixed. Overriding rules are in section 8.

### 2.2 Color, light theme (default)

```
Surfaces
--bg            #F4F2EC   warm white, the window
--surface       #FFFFFF   cards, panels, inputs
--surface-2     #EDEAE2   hover, badges, the terminal chrome
--line          #E3DFD5   hairline borders
--line-strong   #CFC9BC   dividers that must read, input borders

Text
--ink           #1B1F27   primary
--ink-2         #5B6170   secondary: labels, captions, freshness, times
--ink-3         #8A8F9B   placeholders and disabled only

Accent (interactive and selected)
--accent        var(--brand-accent)
--accent-ink    #FFFFFF
--accent-soft   color-mix(in oklab, var(--accent) 11%, var(--surface))

Meter (the fill of a bar that is fine)
--meter         #5B6170
--meter-track   #E9E5DC

Status (state only)
--ok            #2E8B57
--warn          #B87A12
--danger        #C4262E
--stale         #7C818D
--ok-soft       color-mix(in oklab, var(--ok) 12%, var(--surface))       the Diff's added line (1.6)
--danger-soft   color-mix(in oklab, var(--danger) 12%, var(--surface))   the Diff's removed line (1.6)
--ok-ink        #1E7048   a changed file's "+N", text (1.13)
--danger-ink    #B0222A   a changed file's "−N", text (1.13)

Category (identity only: folders, providers)
--cat-1         #3E7C8A   teal
--cat-2         #7A62B0   violet
--cat-3         #8A6A4E   walnut
--cat-4         #6B6F2A   olive
--cat-5         #A8527A   rose
--cat-6         #4E5F8C   slate

Terminal (the pane's own palette, never used outside it)
--term-bg       #F4F2EC   light; #0F0F0F dark (amended 1.2: the pane follows the theme; 1.13: = the dark --bg)
--term-fg       #0A1420   light; #EDEDED dark
--term-selection #CCDDEC  light; #18406B dark
--ansi-*        sixteen colours, a set per theme, every one ≥ 4.5:1 on its --term-bg; --ansi-black = --line,
                --ansi-bright-black = --ink-2, --ansi-yellow = --warn, --ansi-bright-white = --term-fg

Floating layers only
--shadow-float  0 8px 24px rgb(20 23 30 / .12), 0 1px 3px rgb(20 23 30 / .08)
```

Rules:

- **Accent** marks the interactive and the selected. It is never a bar fill, a status, or a category.
- **Status colors** appear as dots, bars, and segments. They are never text, with one exception: `--danger` for an error message (5.7:1 on `--surface`). (1.6, tree changes: and, in the Diff only, a faint tint behind a whole line — `--ok` for an added line, `--danger` for a removed one, mixed into `--surface` — always with the line's + or − beside it, so the sign says in a word what the tint says in colour. They are `--ok-soft` and `--danger-soft`, 12 % light and 18 % dark, as `--accent-soft` is mixed; the line's text and its numbers on them are measured in 2.4.) (1.13, the interface polish: and a changed file's line counts in a tree, "+N" in `--ok-ink` and "−N" in `--danger-ink` — text tokens measured to 4.5:1 on `--bg` and `--surface` in both themes, light `#1E7048` (5.4:1 on `--bg`) and `#B0222A` (6.0:1), dark equal to `--ok` (7.4:1) and `--danger` (5.3:1) — the sign always written beside the number. In 2.2's and 2.3's blocks.)
- **Category colors** appear as a chip or a chart series, always next to the name they stand for. Each client folder and provider gets one in Settings, and it stays stable. Past six, colors repeat and the name disambiguates.
- **Bars** fill with `--meter` when fine, `--warn` past 80 %, `--danger` past 95 %, and `--stale` when the reading is older than its window. (1.2: these replace the app's earlier ≤ 25 / ≤ 10 % *left* rule; a dead reading draws no bar.)
- **The brand's gold and crimson** appear only as `--warn` and `--danger`.

### 2.3 Color, dark theme

Same token names, swapped values. Never a second stylesheet.

```
--bg #0F0F0F   --surface #171717   --surface-2 #212121   --line #272727   --line-strong #363636
--ink #EDEDED  --ink-2 #A3A3A3     --ink-3 #6E6E6E
--accent       color-mix(in oklab, var(--brand-accent), white 32%)
--accent-ink   #0E1420
--accent-soft  color-mix(in oklab, var(--accent) 18%, var(--surface))
--meter #A3A3A3  --meter-track #272727
--ok #4FB37A   --warn #D9A03A   --danger #E5575E   --stale #7C818D
--ok-soft      color-mix(in oklab, var(--ok) 18%, var(--surface))
--danger-soft  color-mix(in oklab, var(--danger) 18%, var(--surface))
--ok-ink #4FB37A   --danger-ink #E5575E   (equal to --ok and --danger, which read as text on the dark grounds)
--cat-1 #5FA3B2  --cat-2 #9D88D6  --cat-3 #B08E70  --cat-4 #A3A85A  --cat-5 #CF7AA0  --cat-6 #7688B8
--shadow-float 0 8px 24px rgb(0 0 0 / .4), 0 1px 3px rgb(0 0 0 / .3)
```

`--accent-ink` flips to dark because white on the lightened accent drops to about 3.4:1. Amended 1.2 (2026-09-22): the terminal palette *does* change — the pane draws on the window's ground in both themes with the ANSI set of that theme (decided with the light theme of PR #22); a program that paints its own 24-bit theme does not follow.

1.13 (2026-11-15, the interface polish): the dark theme turns neutral, gray with no blue in it — the block above, in `tokens.css` since the build's slice 5 (2026-11-17), the scrim `rgb(0 0 0 / .6)`. `--term-bg` and `--term-fg` follow `--bg` and `--ink`; `--ansi-black`, `--ansi-bright-black` and `--ansi-bright-white` keep tracking `--line`, `--ink-2` and `--term-fg`. The accent, status and category values stay as they were. 2.4 holds the measurements.

### 2.4 Contrast (measured, WCAG 2.x)

| Pair | Light | Dark (1.13) | Needs |
|---|---|---|---|
| `--ink` on `--bg` | 14.7:1 | 16.4:1 | 4.5 |
| `--ink-2` on `--bg` | 5.5:1 | 7.6:1 | 4.5 |
| `--ink-2` on `--surface-2` | 5.2:1 | 6.4:1 | 4.5 |
| `--accent-ink` on `--accent` | 7.6:1 | 5.1:1 | 4.5 |
| `--danger` text on `--surface` | 5.7:1 | 5.0:1 | 4.5 |
| `--ok` dot on `--bg` | 3.8:1 | 7.4:1 | 3 |
| `--warn` dot on `--bg` | 3.2:1 | 8.3:1 | 3 |
| `--stale` bar on `--bg` | 3.5:1 | 4.9:1 | 3 |
| `--ink-3` on `--bg` | 2.9:1 | 3.8:1 | non-essential only |
| `--ink` on `--ok-soft` / `--danger-soft` (1.6) | 14.3:1 / 13.9:1 | 11.9:1 / 12.4:1 | 4.5 |
| `--ink-2` on `--ok-soft` / `--danger-soft` (1.6) | 5.4:1 / 5.2:1 | 5.5:1 / 5.8:1 | 4.5 |
| `--ok-ink` on `--bg` / `--surface` (1.13) | 5.4:1 / 6.1:1 | 7.4:1 / 6.9:1 | 4.5 |
| `--danger-ink` on `--bg` / `--surface` (1.13) | 6.0:1 / 6.8:1 | 5.3:1 / 5.0:1 | 4.5 |

The contrast test (section 9) checks every pair in both themes and at the current brand accent.

### 2.5 Type

```
--font-ui       var(--brand-font-ui), -apple-system, "SF Pro Text", system-ui, sans-serif
--font-mono     var(--brand-font-mono), "SF Mono", ui-monospace, Menlo, monospace
--font-display  var(--brand-font-display), var(--font-ui)   wordmark and launch screen only

Mac scale (px / line-height) — written in tokens.css as the pair --fs-<step> / --lh-<step> (amended 1.2)
--text-xs    11 / 16    freshness, units, times          (--fs-xs / --lh-xs)
--text-sm    12 / 18    captions, table cells, badges     (--fs-sm / --lh-sm)
--text-md    13 / 20    body, labels, nav, buttons        (--fs-md / --lh-md)
--text-lg    15 / 22    section titles, card titles       (--fs-lg / --lh-lg)
--text-xl    20 / 28    page titles                       (--fs-xl / --lh-xl)
--text-num   28 / 32    the hero number in a gauge (mono, tabular)   (--fs-num / --lh-num)
--tracking-caps  0.06em   a group label's and a table header's capitals, and nothing else (1.13)

iPhone scale (px / line-height) — --m-fs-<step> / --m-lh-<step>
--m-text-sm      13 / 18    captions, badges, tab labels
--m-text-body    15 / 22    body, rows, buttons
--m-text-title   20 / 26    screen titles below the large title
--m-text-large   28 / 34    the large title

Weights: 400 regular, 500 medium, 600 semibold. Nothing bolder.
```

Rules: labels are sentence case, never all caps, never letter-spaced. Numbers are always mono with tabular figures, right-aligned in tables, and carry their unit in `--ink-2`. Mono is for numbers, code, paths, keys, and the terminal. It is never for labels or prose. (1.13, the interface polish: one exception. A label that heads a group of rows — the sidebar's Pinned and Client folders, the palette's groups, the Settings section list's groups — and a table's column headers are set in capitals: `--text-xs`, weight 600, letter-spaced by `--tracking-caps` (0.06em), `--ink-2`, as the class `.ui-group-label`. A name — a folder, a file, a task — is never put in capitals, so the Files head, a folder's name, stays as typed.)

The display font must be redistributable, since it ships in an open-source repo. Amended 1.2 (2026-09-22): Clash Display's ITF Free Font License does not permit sharing the files, so the display face is **Bricolage Grotesque** (OFL) — `--brand-font-display: "Bricolage Grotesque"`. Inter and JetBrains Mono (OFL) are bundled with the app as woff2 files under `app/src/assets/fonts/`, each with its license beside it; nothing is fetched at runtime.

### 2.6 Space, radius, layout

```
Spacing on a 4 px grid
--space-1 4   --space-2 8   --space-3 12   --space-4 16   --space-5 24   --space-6 32   --space-7 48
--space-0 2   --space-1h 6   (amended 1.2: the two sub-grid steps, for gaps inside a component — a dot and its word,
                             a label and its value — never for layout)

Radius
--radius-sm 6    inputs, badges, nav items
--radius-md 10   cards
--radius-lg 14   panels, the reader, dialogs, sheets

Layout
--sidebar-w     220   --panel-w   360 (the panel's default share; the divider decides, down to --pane-min 280 — amended 1.2)
--chrome-h      32    --strip-h   96
--page-max      1120  --row-h     36     --row-h-progress  56
--hit           28    --hit-touch 44     --tabbar-h        49 (plus the safe area)

Borders: 1 px --line. No shadows on cards. --shadow-float only on the palette, menus, toasts, and sheets.

Geometry (amended 1.2): --focus-w 2 · --icon 16 · --icon-sm 14 · --dot 7 · --dot-ring 1.75 · --chip 10 ·
--bar-h 4 · --bar-h-inline 2 · --radius-pill 999. Motion: --dur-fast 150ms · --dur-slow 200ms (2.7).
```

### 2.7 Motion

150 ms ease-out for hover and reveal, 200 ms for panels and sheets. Nothing bounces, and no number animates. Respect `prefers-reduced-motion`.

Amended 1.2 (2026-09-22): in the Mac app a **background never transitions**. WKWebView freezes a `background` or `background-color` transition across the window's theme change — every element with one kept its dark colour on a light page — so hover and reveal motion applies to `transform`, `opacity` and `width`, and a background changes at once; `app/src/styles/guard.test.ts` refuses a background transition.

## 3. Layout

### 3.1 The Mac window

The window has three columns: the sidebar (`--sidebar-w`, `--bg`), the page (fills, `--bg`), and the right panel (`--panel-w`, `--surface`, holding the reader or a task detail). Column boundaries are `--line`. The page never scrolls sideways.

The sidebar holds, top to bottom: the wordmark, the navigation (Home, Work, Crew, Inbox with its count, Usage), what can be opened (Pinned, the open folder's files), the client folders with their category chips, the shell's last notice, one line for the VPS connection, and Settings, the last row. It collapses with the key defined in `keymap.md`. The proposed key is ⌘\, because ⌘S means save wherever the Reader edits.

(1.5, the reader's layout — the title bar.) Kinas draws the window's title bar (4 Title bar): one row across the whole window, above the three columns and spanning them, `--chrome-h` tall on `--bg`, with a 1 px `--line` along its foot. It is there on every page, with the sidebar shown or hidden, with the reader expanded, and in full screen. The columns fill the window below it. There is no title text: each page names itself.

(1.5, the reader's layout.) Recent has left the sidebar: the files opened this session are the reader's tabs (4 Tab strip), and a folder is kept at hand by pinning it. Pinned, Files and the client folders are unchanged, and between them every folder that had the pin and terminal buttons still has them.

(1.4, the first mate.) The right panel holds one thing at a time: a task's detail or the reader. Selecting a task — a card on Crew, a row on Home — shows its detail; opening a file, a report or a brief shows the reader; × closes the panel.

(1.3, folder views.) There is no Reader row: every file and folder row opens the reader, and × closes it. A client folder is **shown**, **hidden** (off the sidebar and Home, still in Settings' list with its In sidebar switch off) or **removed** (off Settings' list too, in its Removed list with Restore; nothing on disk is touched). A right-click on a client folder opens a Menu: Hide from sidebar, Add a client folder…, then Show for each hidden folder; on the heading, the same without Hide. An added folder is any folder inside the projects folder, git or not. Colours are seated over every folder, hidden and removed ones included, so hiding one never repaints another.

(1.13, the interface polish.) The window gains a **Status bar** along its foot (4): one row below the three columns and spanning them, `--hit` tall on `--bg` with a 1 px `--line` along its top, on every page, with the sidebar hidden and in full screen. Like the title bar it is a static part of the window, never conditional, so the terminal is never re-mounted. The sidebar gains a **search row** under the wordmark — a magnifier, "Search" and the palette's chord as a `Kbd` — that opens the palette; the nav rows show their chord as a `Kbd` while pointed at or focused; and each client folder shows, at its right, the crew's most pressing word with a count — needs you (a `--warn` ring), else failed (a `--danger` dot), else working (a neutral dot) — and below it up to three tasks in flight, one line each (the dot, the title, the elapsed time in its largest unit), then "N more". The VPS connection line leaves the sidebar for the status bar; the sidebar ends with Settings.

### 3.2 A page

A page opens with a title row: the page title in `--text-xl`, then quiet actions on the right. Then come sections. A section is a title in `--text-lg`, an optional one-line caption in `--ink-2` beside it (where freshness lives), and its content. Sections are separated by `--space-6`, not by lines. Content has a max width of `--page-max`. Tables and the terminal may use the full width.

Density is like Linear: 13 px body, 20 px line height, 36 px rows, 16 px card padding.

### 3.3 The iPhone

The phone does three jobs: see the night's progress, approve (plans and PRs), and launch crew tasks. It has no terminal, reader, usage detail, or settings. Those open on the Mac.

- A single column with 16 px side margins, and a large title per screen.
- A bottom tab bar: Home, Inbox (with count), Crew, Launch.
- Every target is at least `--hit-touch`. The primary action sits at the bottom of the screen, above the safe area, within thumb reach.
- The iPhone type scale from 2.5. Color, radius, and status rules are unchanged.
- Token delivery: a web or Tauri mobile app reads `tokens.css`. A native Swift app gets `KinasTokens.swift`, generated from the same `tokens.json`.

## 4. Components

Each component exists once in `app/src/ui/` and is used by name. An agent that needs something not covered here adds a component here first.

**The catalogue (as built, 1.2).** Every state below is a story: a debug build opened with `#stories` (the address bar's hash, then reload) renders each as `section[data-story="<Component>/<state>"]` in the current theme, and `app/src/ui/stories.test.ts` holds this table equal to `app/src/ui/stories/catalogue.tsx`.

| Component | Stories |
|---|---|
| Button | primary, secondary, text, hint, disabled |
| StatusBadge | queued, working, blocked, red, done, stale, dead, decision, pr, review, ready, failed, paused, unknown, gone, counted |
| HealthBadge | installed, below-floor, missing, optional, signed-in, not-signed-in |
| Dot | solid, ring, cross |
| Chip | cat-1, cat-2, cat-3, cat-4, cat-5, cat-6 |
| Tag | internal, order |
| ChangeMark | added, modified, deleted, rollup, rollup-many, crew, crew-rollup |
| Gauge | fine, warn, danger, stale, dead |
| Bar | fine, warn, danger, stale, inline, segmented |
| MetricRow | rows, attention |
| SectionHeader | reading, activity, info, plain |
| TitleRow | home |
| Table | today |
| Card | plain, selected |
| Lane | with-cards, empty, no-chip, internal |
| ProgressRow | list, quiet |
| InboxItem | plan, decision, answering, copied, compact, held-pr |
| Timeline | task |
| Diff | modified, deleted, no-copy, too-many, crew |
| Toast | success, error |
| EmptyState | with-action, plain |
| TerminalChrome | working, shell, first-mate, vps, connecting, reconnecting, unreachable |
| Panel | task-detail |
| Nav | sidebar, live-folders, folder-icons, reader-icons |
| Menu | plain, disabled, divider |
| TabStrip | plain, many, dragging, same-name |
| TitleBar | start, back-and-forward, sidebar-hidden, fullscreen |
| Field | text, secret, switch, accent |
| Section | usage |
| Badges | row |
| PaletteRow | files, commands, indexing, foot |
| StatusBar | readings, tones-crew-vps, vps-stale, empty |
| UsagePopover | providers, empty |
| SettingsRow | rows |
| LineCounts | modified, added, deleted |

**Button.** Three kinds: primary (`--accent`, `--accent-ink`), secondary (`--surface`, 1 px `--line-strong`, `--ink`), and text (`--ink-2`, no border). Height is `--hit` on the Mac and `--hit-touch` on the phone. The label names exactly what happens ("Approve plan", not "Submit"), and the toast that follows uses the same verb. (1.13: the `Kbd` beside a label or inside a button has a `--surface-2` fill; it is also how the palette, the nav rows, the search row and the Usage popover show a chord.)

**Gauge.** A title (`--text-md`, `--ink-2`), the number (`--text-num`, mono), and the unit and phrase beside it ("% used", "of 50 GB"). Below it sits a 4 px bar on `--meter-track`, filled per 2.2, and one line of detail ("resets in 3 h 43 m, 13:30"). A stale reading renders the bar in `--stale` and the detail as "09:31, stale" in `--ink-2`. A dead reading shows "No reading" and no number. There is no dot in the corner, because the bar is the status. (1.2, as built: a window past its reset shows "—" in the number's place and "reset at 14:10 · waiting for a new reading", because its stored number belongs to a window that ended.)

**Metric row.** A label on the left, an optional 2 px inline bar, and the value on the right in mono with its unit in `--ink-2`. Rows stack inside a section. Nine Convex metrics are nine rows, not nine tiles. A value past its limit (the 312 % case) fills the bar with `--danger` and puts "upper bound" in the unit slot. (1.2, as built: a figure with no allowance draws no bar at all — an empty one would read as "none used"; the rows of one card share their columns, so the bars line up whatever each value says; a live reading that moves every minute — a CPU, a VPS's memory — draws no bar either.)

**Section header.** A title, an optional caption, and an optional right-side action. The caption carries freshness in one of two forms: "as of 09:31" for readings, or "since 23:40 yesterday, 7 h 50 m" for activity. Hovering the caption shows the source. This is the only place freshness appears, except for stale readings.

**Status badge.** A pill in `--surface-2` holding a dot and a word. The word is in `--ink`, and the dot carries the color. A solid dot shows what the system is doing; a ring shows that it is waiting on a person.

| State | Dot | Color |
|---|---|---|
| queued | solid | `--stale` |
| working | solid | `--meter` |
| blocked | solid | `--danger` |
| CI red | solid | `--danger` |
| done | solid | `--ok` |
| stale | solid | `--stale` |
| dead | cross | `--ink-3` |
| needs decision | ring | `--warn` |
| PR open | ring | `--meter` |
| in review (1.12) | ring | `--meter` |
| ready | ring | `--ok` |
| failed (1.4) | solid | `--danger` |
| paused (1.4) | solid | `--stale` |
| unknown (1.4) | solid | `--stale` |
| gone (1.4) | cross | `--ink-3` |

(1.4) The crew's tool health in Settings uses the same pill with its own words: installed (solid `--ok`), below floor (solid `--warn`), missing (solid `--danger`); for `gh`, signed in (solid `--ok`) or not signed in (solid `--danger`); an optional tool that is missing is missing in `--stale`.

(1.14) The Work page's pane on a VPS uses the same pill with its own words while it is not attached: connecting (solid `--stale`, from a start until the pane first draws), reconnecting (solid `--warn`) and unreachable since 14:02 (solid `--danger`, the status bar's own time).

(1.4) The crew's states map to these words, first match wins: gone, done, failed, needs decision (a pending decision, parked, or held for a person), blocked, paused, ready (an open PR, not a draft, mergeable, at least one check and all green), CI red (any failing check), PR open, working, queued, unknown.

(1.12, Firstmate, current) The order gains **in review** — a task Firstmate reports paused *by park on review* (its state `paused`, its source `review-park`) — after blocked and before paused: gone, done, failed, needs decision, blocked, in review, paused, ready, CI red, PR open, working, queued, unknown. A parked lane whose relaunch failed is reported blocked and reads blocked. With Firstmate's fleet ledger on, a task whose `task.merged` Kinas has kept reads done even while the snapshot still lists it, and a merged task the snapshot stopped listing reads done, not gone. The backlog's old word "parked" still reads needs decision.

When counting, the number comes first in mono ("4 done").

**Progress row (new).** One row per client folder, `--row-h-progress` tall. It holds:

- the folder's category chip and name (`--text-md`, 500);
- one line in `--ink-2` with the latest event and its time;
- a 4 px segmented bar showing done (`--ok`), working (`--meter`), waiting on a person (`--warn`), and failed (`--danger`);
- count badges for non-zero states only;
- a chevron.

Selecting a row opens that folder's most important task in the right panel: the one waiting on a person first, then the failed one, then the latest. A folder with no overnight activity shows "No work overnight" in `--ink-2` and no bar. Internal folders carry an "internal" badge and sort last.

**Card.** `--surface`, `--radius-md`, 1 px `--line`, 16 px padding. Selected: an `--accent-soft` background and a 2 px `--accent` left edge.

**Table.** For lists that are read, not browsed. The header is in `--text-sm` `--ink-2`. Rows are `--row-h`, numbers are right-aligned mono, hover is `--surface-2`. No zebra stripes, no vertical lines. (1.13: the header takes the group-label style of 2.5, in capitals.)

**Timeline.** A vertical list with the time on the left (`--text-xs` mono, `--ink-2`), a status dot, and the text. Orders from the captain carry a small "order" badge. (1.12, Firstmate, current: with Firstmate's fleet ledger on, its four events join the list at their own times, once each — `dispatched · claude` with working's dot, `PR #12 ready` with ready's, `merged · PR #12` or `landed locally` with done's, `cleaned up` with gone's.)

**Inbox item.** The question in `--text-lg`, the evidence as a collapsed section, the recommendation in one line, and three actions: Approve (primary), Answer (secondary), Deny (text). On the Mac the keys are A, R, and D when the item is focused. There are two variants:

- **Compact (Home):** the question in `--text-md` 500 with the folder chip, the recommendation in `--ink-2`, and the actions inline.
- **Phone:** the actions pinned to the bottom of the screen at `--hit-touch`.

(1.4, the first mate.) The evidence and the recommendation are drawn only when the item's source carries them; the crew's decisions carry a question alone (Firstmate's summary line), so they show the question, then a quiet line with the task's title, the key and the age. Approve sends at once; Answer and Deny open a text box with Send, and the item then reads `Sending…`, `Sent 15:02`, or `Not delivered — <reason>` in `--danger`. An item that cannot be answered from Kinas (a task held for the captain whose worker is gone) says "Answer in the first mate's pane" with one secondary button, Go to the first mate, and has no keys. A, R and D are bound in `keymap.md`.

(1.7, slice 0's probe: Firstmate takes a person's answer only in the first mate's chat.) A crew item is answered the same way wherever it sits and whatever its source — a decision or a held task, its worker alive or gone. Approve puts the answer line on the clipboard at once and goes to the first mate's pane; Answer and Deny open the text box, whose button is Copy and go (primary), with one quiet line of hint under it: "Goes on the clipboard for the first mate's pane · Enter copies, ⇧Enter a new line, Esc closes". After either, the item reads "Copied 15:02 — paste it into the first mate's pane" in `--ink-2`, keeps its three actions so it can be copied again, and still counts; it leaves only when Firstmate closes it. There is no Sending, Sent or Not delivered state, and no item without keys. The shell's notice line on the Work page says "Your answer is on the clipboard — paste it into the first mate's pane."

(1.12, Firstmate, current.) A question keeps its line breaks wherever it is drawn as a question — the Inbox item and the detail's question card (`white-space: pre-line`), up to the 2,000 characters a hold's text is capped at; a line that flattens it, such as Overnight's latest event, joins its lines with spaces. A held task whose PR Firstmate names reads, in its quiet line, `Held for you · <title> · PR #12 · <age>`, and has one more action, **Open the PR** (text), before Deny: it opens the PR in the browser and changes nothing on the item. Its compact form on Home names the PR in its quiet line but has no Open the PR. Open the PR has no key; it is reached by click and Tab, as every crew control is.

**Lane.** A column on the Crew board with one lane per client folder. The header holds the folder name, its category chip, and the provider slots as "Claude 1/1 · Codex 1/2" in mono. Task cards follow. An empty lane shows one line of quiet text. (1.4, the first mate: the header counts in Firstmate's words — "2 in flight · 1 queued", the numbers in mono — because Firstmate publishes no slots; in flight is started and not finished, whatever the badge says. A crew project is a client folder's lane when both name the same GitHub repository; a project no folder matches has a lane under the repository's name with no chip, after the folders'. On the board a lane exists only while it has a task, so the empty line is for other callers.)

**Terminal chrome.** A `--chrome-h` bar above the pane in `--surface-2`. It holds the session name, a status badge, and the profile, with Detach and Copy on the right. The pane uses the terminal palette, and nothing else in the app does. (1.2, as built: a sibling above the pane, never around it, rendered from the first frame so the terminal is never remounted; the session is `default`, a debug build's test session, or a plain shell (badge stale, "plain shell"); Copy copies the pane's selection as a mouse copy does. Detach waits for a Herdr-CLI door.) (1.4, the first mate: the session name is followed by the focused workspace's label — `default · firstmate`, `default · fm-<id>`; the badge is drawn only when the focused pane is a crew worker's, with its task's word; the profile is `claude` when Herdr reports it in the foreground, `plain shell` for the shell. Nothing is drawn from a guess.) (1.14, as built: on a VPS the pane is this Mac's Herdr attached to the VPS's `default` session, and the chrome names the place first — `vps-1 · default · shop`. Its detached badge comes before the crew's: `connecting` until the pane first draws, `reconnecting` while Herdr's client is starting again or the door has failed since it last worked, `unreachable since 14:02` while the status bar says unreachable — the bar's own state, so the two never disagree. The pane is dimmed while the badge shows. When Herdr's client exits, the pane starts it again by itself after 2 s, then 5, 10 and 30 s while each attach ends within 30 s, and says so in the pane; Enter starts it at once. A new place in Settings starts the pane again on it.)

**Reader header.** As built: file name, Rendered/Source toggle, Copy, the ▾ menu, Expand, and Close, in `--text-md` with `--ink-2` icons. (1.2: on the tokens, `--hit` tall, its six icons drawn on the 16 grid in `app/src/ui/icons.tsx`; it stays the reader's own, not a library component.) (1.3: its ▾ menu is the library's Menu.) (1.5, the reader's layout: **Files** and **Contents** sit after the path and its badge, before Copy, whenever their section is offered — Contents for a document taller than the reader with two headings or more, Files while the reader draws its own tree — at every width. Wide (640 px or more) each hides and shows its section beside the text, `aria-pressed` while it shows, with the tooltip saying what a click will do: "Hide Contents", "Show Contents", "Hide Files", "Show Files". Narrow, each opens its section over the text, pressed while it is open, with the tooltips "Files" and "Contents"; a narrow click never changes what wide remembers. Back has gone from the header: the title bar's ← walks every place, the reader's files among them, and two Backs side by side would be tripped over. The header starts with the view toggle, or with the path for a file that has only one view.)

**Tab strip (new).** (1.5, the reader's layout.) One row at the top of the reader, above its header, holding a tab for every file opened this session — never stored, gone on quit. It is `--chrome-h` tall on `--surface-2` with a 1 px `--line` along its foot. A tab is the sidebar's file icon, the file's name in `--fs-sm`, and its ×: the showing tab sits on `--surface` in `--ink`, joined to the header below it, the line stopping under it; the others are `--ink-2`, and `--ink` under the pointer. The × shows on the showing tab and on any tab under the pointer, on a `--line` square when pointed at. A tab is at most `--sidebar-w` less `--space-5` wide (196 px), and a long name ends in an ellipsis. Two tabs of one name each add their parent folder's name after a dot, in `--ink-3` ("prd.md · first-mate"). The tooltip is the display path, as the header's path says it. When the tabs do not fit, the strip scrolls sideways and the showing tab is kept in view; the window never scrolls sideways. A tab being dragged lifts — `--surface`, `--shadow-float`, `--radius-sm`, raised half a `--space-1` — and the others make room. Clicking a tab never moves keyboard focus. Named Tab strip so it is never taken for the phone's Tab bar.

**Title bar (new).** (1.5, the reader's layout.) The window's title bar, drawn by Kinas over macOS's own, which is hidden but keeps its traffic lights. From the left: the traffic lights, then three buttons — the sidebar button, ← and → — `--hit` square, `--space-1` apart, with icons on the 16 grid in `--ink-2`; under the pointer a button sits on a `--line` square, `--radius-sm`, in `--ink`. A button that cannot act stays in place, `aria-disabled`, in `--ink-3`, with the reason as its tooltip: "Nothing to go back to", "Nothing to go forward to". The sidebar button's tooltip says what a click will do, with the chord Settings has bound: "Hide the sidebar (⌘S)", "Show the sidebar (⌘S)". ← and → walk the places visited, like a browser's: a place is the page showing and what the reader shows — a file, at the scroll it was left at, a folder with no file, or nothing. Every pixel that is not a button moves the window when dragged and zooms it when double-clicked, as a title bar does, whatever the Mac's own double-click setting says; a button is never a drag region. In full screen the traffic lights are gone, and the buttons start at the bar's `--space-3` padding. Clicking a button never moves keyboard focus: the terminal keeps the keys. No title, and nothing else: the bar is the window's, not a page's.

**Menu (1.3).** A `--surface` sheet with a 1 px `--line` border, `--radius-md` and `--shadow-float`, one item per action in `--fs-md` `--ink`; the focused or pointed item sits on `--line`, and an item that cannot be used stays in place in `--ink-2` with the reason as its tooltip. A divider is 1 px `--line` and the arrows skip it. It takes focus when it opens and gives it back when it closes, so nothing typed at an open menu reaches the terminal (keys in `keymap.md`). Its place is the caller's: under the reader's ▾, at the pointer for the client folders' right-click.

**Palette.** A floating layer with a single input and a list. Matches show in `--accent`, and it has `--shadow-float`. (1.13, the interface polish: one search for everything. Groups in a fixed order — Recent (before anything is typed), Commands, Open, Files, Client folders, Tasks, Inbox, Workspaces, Settings — each under a group label (2.5), each showing five **Palette rows** then "N more", each hidden when it has no match. A source still being read, or one that failed, says so in one `--ink-2` line. The foot lists ↵ Open, Esc Close and ↑↓ Move as `Kbd`s. Matched letters are weight 600 rather than `--accent`, since the accent means selected and the selected row is `--accent-soft`.)

**Settings field.** The label above, the control below, and help text in `--ink-2`. Secrets are write-only fields with a "Stored in Keychain" caption. Groups are cards. (1.2, as built: in Settings each group's title is the label of the one control or the row of controls it holds.)

**Accent field (new).** A color control in Settings, Appearance. It shows the contrast of `--accent-ink` on the accent in both themes. If either is under 4.5:1, it offers the nearest passing shade and will not save the failing one.

**Tab bar (new, phone).** Four tabs with icons and `--m-text-sm` labels. The current tab is in `--accent`, the others in `--ink-2`. The Inbox tab shows its count.

**Launch form (new).** Used on the phone and in the Mac palette. It has four fields:

- the folder, as a picker showing category chips;
- the brief, as a text field;
- the provider, as a segmented control showing free slots ("Codex 1 of 2 free"), with full providers disabled;
- "Ask for a plan before building", a switch that is on by default.

It ends with one primary button, Launch task. (1.4: not with the first mate — tasks are asked of it in its pane.)

**Switch (new, phone).** 51 × 31 pt. On is `--accent`, off is `--line-strong`.

**Empty state.** One sentence in `--ink-2` and one action. Never an illustration. (1.13: a line, not a box — the sentence sits where the content would be, its action beside it, with no border and no fill.)

**Change mark (new, 1.6).** What changed in a file tree since the tree was first shown, at the right end of the row, before the folder actions: the Dot (solid, `--dot`) in a status colour, then the letter in `--text-xs` mono `--ink-2` — **A** added (`--ok`), **M** modified (`--warn`), **D** deleted (`--danger`). A folder that existed at both moments carries a **roll-up** instead: the dot in the colour of the strongest change beneath it (deleted over modified over added) and the count of changed entries beneath, an added or deleted folder counting once, "99+" past 99. A **deleted** row stays in its place with its name struck through, in `--ink-2`; a deleted folder has no caret. The words — "overview.md, modified since 14:02", "docs, 3 changes inside since 14:02" — are the row's accessible name and the mark's tooltip; the mark itself is hidden from assistive technology, and the row's name, text and tooltip are otherwise unchanged. The accent is never a mark: a changed row that is open shows the `--line` fill and its mark. Under a tree's head, while it has marks, one caption line in `--text-xs` `--ink-2`: "5 changes since 14:02". Amended 1.8 (2026-09-25): a mark goes by itself once its text is on the branch's remote, and text already there is never marked. A mark waiting for a push adds ", not pushed" to its words — "overview.md, modified since 14:02, not pushed" — and one git ignores, or outside any repository, does not. Each mark's "since" is its own: the tree's first showing, or the push or ↻ that last cleared that path; a roll-up and the caption say the earliest among what they count. Amended 1.9 (2026-09-28): a **crew mark** is the same letter with the Dot drawn as a ring (`--dot-ring`, the status colour), for what the crew has changed in its own checkouts and not pushed; it goes when the crew pushes. On a row with both, the crew's mark comes first and the captain's sits at the row's end. The words say whose: "plan.md, modified by the crew, not pushed", "(2 tasks)" when more than one checkout has it, joined after the captain's own with "; also". A folder with crew marks beneath carries a crew roll-up: the ring in the strongest colour and the count, "docs, 3 changes by the crew inside, not pushed", beside the captain's own. A file the crew added or rewrote that the captain's folder lacks is a **crew row** in its sorted place, its name in `--ink-3`, its words ending "— not in your folder"; a folder the crew added is one such row with no caret. While a tree has crew marks, a second caption line in `--text-xs` `--ink-2`: "The crew: 4 changes not pushed". Crew marks are never "since": ↻ leaves them, and they do not join the first line's count.

**Diff (new, 1.6).** The reader's Changes view: a file against its text when its tree was first shown. Unified, one column. A summary line — "+12 −3" in mono `--ink`, "since 14:02" in `--ink-2` — then the rows: two line-number gutters (before, now) and a sign gutter (+, −, empty) in `--text-xs` mono `--ink-2`, then the line in the source view's mono and highlighting, wrapped. An added line sits on the `--ok` tint, a removed one on the `--danger` tint (2.2). Three lines of context around each change; a longer unchanged run folds into one row on `--surface-2` between hairlines, "40 unchanged lines" in `--text-xs` `--ink-2`, which unfolds in place when clicked. A deleted file opens under the line "Deleted since 14:02 — what it said then", every line removed. Where there is nothing to compare, one line in `--ink-2` takes the diff's place and says why, in Rust's words. Amended 1.8 (2026-09-25): "since" is the file's own — the push that last cleared it, when one did — so the diff shows only what is not pushed yet. Amended 1.9 (2026-09-28): **the crew's copy** is the same Diff, read-only, of the crew's text against what its branch last pushed. Its summary says whose instead of since when — "+12 −3" in mono `--ink`, then "The crew's copy, not pushed" in `--ink-2`, and " · 1 of 2 tasks" when more than one checkout has it — and a crew row's file opens under the line "Added by the crew — not in your folder". The reader's view toggle gains a fourth button, "The crew's" (two rings, the new icon), while the open file has a crew mark; a status line reads "Read-only: this is the crew's copy".

**Toast.** Bottom center, 3 s, one line, one optional action. Success has no color; only errors use `--danger`. (1.2, as built: the placement is the caller's — the terminal's "copied to clipboard" sits in the pane's corner, clear of a prompt; the sidebar's notice at its foot.)

(1.13, the interface polish.) Every list row leads with its name: in sidebar rows, Overnight's progress rows, crew cards, inbox items, palette rows and Settings rows the thing's name is `--ink` at 500 and everything else `--ink-2` at 400, the details on one line joined by " · " and ending in an ellipsis when they do not fit. A row never wraps; a card's elapsed time is `nowrap`.

**Status bar (new, 1.13).** The window's foot (3.1), `--text-sm`, `--ink-2`. On the left, the readings of Home's three gauges, each its name and its percent in mono `--ink` ("Claude session 97%"), with the tone's `Dot` only when warn, danger or stale; with nothing configured, one button, "No usage readings — Settings → Providers". On the right, the crew's counts, each a `Dot` and its words ("1 needs you · 2 working"), and the VPS (its name, its dot and its state). Each part is a button reachable by Tab: the readings open the **Usage popover**, the counts the Crew page, the VPS the Usage page at its section. *1.14:* while agents run on a VPS, the VPS part is that machine instead of Hostinger's reading: its label, its dot and one of four states — `connected` (`--ok`), `reconnecting` (`--warn`), `unreachable` (`--danger`) and `Kinas on the VPS is not running` (`--warn`) — with its hover saying since when, the last reading and why (`vps-1 · unreachable since 14:02 · last reading 14:01 · can't reach vps-1: timed out`); it opens Settings → Where agents run.

**Usage popover (new, 1.13).** A floating `--surface` sheet above the status bar's readings, `--radius-md`, 1 px `--line`, `--shadow-float`. A block per configured provider: its `Chip`, its name and one "as of" time; then per window a label, a `Bar`, and below it "24% used" on the left and its reset on the right (6). Convex's metrics with an allowance are windows too; the VPS is not here. The foot is "Open Usage" with its `Kbd`. Esc or a click outside closes it, and focus returns to the readings.

**Palette row (new, 1.13).** One result: the kind's icon in `--ink-2`, the name (`--ink`, 500, matched letters 600), one line of detail in `--ink-2` — a path in mono `--text-xs`, a status word with its `Dot`, an age — and at the right the client folder's `Chip` and name when it belongs to one, an age in mono, or a command's chord as a `Kbd`. `--row-h` tall; the selected row is `--accent-soft`. A palette group is its group label, its rows and "N more".

**Line counts (new, 1.13).** Before a file's Change mark in a tree: "+N" in `--ok-ink` and "−N" in `--danger-ink`, mono `--text-xs`, the sign always written. An added file shows only +N, a deleted one only −N; a binary file, a folder's roll-up and a crew mark show none. When the row is too narrow for both, the counts give way before the name is cut, and the row's tooltip always says them.

**Settings row (new, 1.13).** One setting: its label (`--ink`, 500) and a one-line description (`--ink-2`, `--text-sm`) on the left, its control on the right; a wide control — a path, a key, a list, a table — sits under the label at the row's full width. A section's rows share one **Card**, with 1 px `--line` between them. Each row carries `data-setting` with its id, the id the palette opens.

## 5. The pages

**Home (new, the first screen).** It answers one question: what happened while I was away, and what needs me. The page has a title row and three sections:

- **Title row:** "Home", the waiting count as a secondary button that opens the Inbox, and Launch task (primary).
- **Overnight (the hero):** one progress row per folder under `clients/`, with internal folders last. The caption says "since" followed by the end of your last session on any device, capped at 24 hours.
- **Waiting on you:** up to three compact inbox items, newest first, with "All 5 in Inbox" when there are more.
- **Usage:** the three gauges that decide the day, compact. Below them is a "Needs attention" list of metric rows for anything in `--warn`, `--danger`, or stale across Convex, the Hostinger VPS, Ollama, and this Mac. When nothing needs attention, one line says "Everything else is within limits." The caption is "as of" the oldest reading shown.

*As built (1.2, 2026-09-23):* the waiting count button arrives with the Inbox (its count is zero until the crew). Overnight has no caption until an event log exists, and each folder says "No work overnight in this folder."; a row opens the folder in the reader. (1.3: only shown folders are listed; with every folder hidden, the empty state says Settings → Client folders shows them again.) Waiting on you is the empty state. Needs attention lists every reading at 80 % used or more, stale or dead, every configured reader in error (once, with its reason), and this Mac's memory or disk past 80 % — never a CPU; danger first. Launch task goes to the Work page with the terminal holding the keys.

*1.4 (the first mate):* "the end of your last session" on the Mac is the last time the window had focus before a stretch of 60 minutes without it (Kinas notes the focus at most once a minute); the caption is capped at 24 hours. A folder's row counts the tasks of its lane with an event inside that window — done; working (queued, working, PR open, paused, unknown); waiting on a person (needs decision, ready); failed (failed, blocked, CI red) — and says "No work overnight in this folder." when there are none. (1.10, done work clears: a finished task a row has counted is left out from Home's next load, so Overnight tells each finish once; the Crew page clears its own cards apart.) (1.12, Firstmate, current: in review counts as waiting on a person, beside needs decision and ready; with the ledger on, a row counts each task at the ledger's own times, so work merged and torn down while Kinas was closed is counted done in its window.) Waiting on you shows the Inbox's items in the compact variant: Approve inline, Answer and Deny open the item on the Inbox page. (1.5: Approve inline copies the answer line and goes to the first mate's pane, as on the Inbox.) The waiting count button is hidden at zero. Launch task goes to the first mate's pane when it runs.

*1.13 (the interface polish):* folders with no work in Overnight's window share one line after the busy rows — "No work overnight in" and each folder's chip and name, each opening it in the reader; with no work anywhere, that line is the whole section. Needs attention leaves out the readings the three gauges above already show; with none left it says "Everything else is within limits."

**Usage.** It answers: how much of what we pay for is left. It opens with a hero row of the three gauges, larger. Below that comes one section per provider, each with its plan name and a single freshness caption:

- **Claude:** model usage as a chart.
- **Ollama:** credits, concurrency, and requests by model as metric rows.
- **Convex:** nine metric rows, with the month caveat as an info icon on the section header.
- **Hostinger VPS:** state, uptime, CPU, memory, disk, and network as metric rows.
- **This Mac:** three metric rows.
- **Crew (1.12, Firstmate, current):** while the captain has set a lane cap, a metric row **Lanes** — `2 of 4 in use`, its inline bar filled to the lanes in use — stale by the section's own rule; without a cap the row is not drawn.

Chart bars are colored by provider category and the legend lists providers only; models appear in the tooltip and in "Show as table". "Today" and "Month to date" are tables inside each provider's section.

*As built (1.2, 2026-09-23):* the hero is Claude's week and session and Ollama's first window. Ollama's other windows are metric rows and its requests per model a table per window. Convex's rows read "250,000 calls of 1,000,000 calls · 25% used", the window said once as the rows' title, today's figures and the metrics without an allowance in their own cards. The VPS is one card named for the machine (`hostname · plan · state`), its live state rows without bars and its month's traffic a figure. The chart and its Today and Month to date tables (per harness · model) sit in the Claude section, since the transcripts they read are the coding harnesses'.

*1.13 (the interface polish):* the model chart's days start at the first day with data and span at least 7 days and at most the 30 of today; "No data before …" stays while the first day is inside the 30. Tables' headers take the group-label style (2.5). The VPS section is the status bar's target.

**Work.** The terminal pane fills the page under its chrome. The launch screen inside it keeps the wordmark and the situation panel, with labels following the type rules. The folder lanes and the review queue sit in a collapsible strip above the pane (`--strip-h`), hidden with the key in `keymap.md`. (1.2: the chrome is built; the strip arrives with the crew.) (1.4: the strip does not come with the crew — the Crew page and the Inbox are those lists, and a strip would need a key and a second copy of each; it waits for a reason of its own.)

**Crew.** A board with one lane per client folder, cards inside, and the inbox count in the title row. Task detail opens in the right panel with the brief, the plan, the timeline, the PR checks, the report link, and the session button. (1.4, the first mate: the title row holds the waiting count, hidden at zero, and First mate — Launch the first mate until it runs. Before setup the page is one empty state with the setup command and Copy, above the tool table; before the first launch, the tool table and Launch. A card holds the title, ship or scout, the badge, the elapsed time, the harness, the PR with its checks, and Open its pane. There is no plan in Firstmate's contracts, so the detail shows the ask as filed with Open the brief instead.) (1.10, done work clears: a finished card — done or gone — stays while the page shows it and is gone the next time the page is opened or reloaded, the page's re-reads never taking one away; a done card whose PR is still open stays until the PR is merged or closed. A lane whose cards have all gone goes with them.) (1.12, Firstmate, current: the Fleet section's caption follows the snapshot's time with free lanes while the captain has set a lane cap — `as of 08:02:11 · 2 of 4 lanes free`, or `3 lanes free · auto` — and, while Firstmate holds dispatch, `· dispatch held · <reasons>` in `--warn`, the reasons in Firstmate's own words, at most four; a lane reading older than 120 s says `lanes as of 09:31` instead of the count. With the ledger on, a card's elapsed time counts from dispatch, and `done in` runs from dispatch to merge. The detail shows `branch fm/…` in `--ink-2` mono under the state line when Firstmate names one, and a held task's PR section shows `PR #12` and Open the PR. Two more error lines can sit under the board: `Fleet ledger: unsupported record version N · times from Kinas's own readings` and `Lane capacity: unsupported contract <schema> · showing the last reading`.)

**Inbox.** Inbox items, newest first, with the count in the sidebar. (1.4, the first mate: three groups — Decisions, Held for you, and Reconcile, whose lines are information with no actions and never count.)

**Reader.** As built. Only the header follows the component above, and the body uses the type scale.

(1.5, the reader's layout.) The side column holds Files above Contents; with one hidden, the other takes its whole height, and with both hidden or neither offered the column is gone, line and all, and the text starts at the reader's own left padding. Whether each shows and the column's width are one remembered set for the whole reader (`reader_side`: shows, shows, 220 px until changed), never per file. The column's right edge is its resize grip and looks like the page/reader divider: a 1 px `--line`, a 2 px `--accent` line while pointed at or dragged, a `col-resize` cursor and no text selected during the drag. It drags from 160 to 480 px, and never so wide that the text gets less than 320 px — a reader too narrow for the remembered width draws the column narrower and keeps the width for when it widens; a double-click puts it back to 220. Expanded or not, the column keeps its width in pixels, and the narrow overlay stays 220. Each Contents row has its whole heading as its tooltip. The document fills the reader's width inside its padding (18 px top, 28 px sides, 48 px bottom): no 72ch measure on prose, and tables, code, the frontmatter card, images and diagrams never wider than that. The two short cards, "several files match" and "Open a file outside…", keep 72ch. When the text's width changes — Expand, a divider or the edge, Files or Contents, the sidebar, the window — the line at the top stays at the top, to within one line.

**Settings.** Cards per group: Providers, Crew, Client folders (category colors), Shortcuts, Appearance (theme, accent field, fonts), and Advanced. The tool health list from the crew installer is a table with status badges. (1.2, as built: a card per existing group, in order — the Claude Code connection, Ollama, Convex, Hostinger, shortcuts, the global hotkey, Appearance with the Accent field, the menu bar, launch at login, the organisation, the projects folder, Client folders, the reader, the CLI; the grouping into Providers/Crew/Advanced comes with the crew.) (1.4, the first mate: the groups are Providers — Claude Code, Ollama, Convex, Hostinger; Crew; Client folders — the projects folder and the folders; Shortcuts — the shortcuts and the global hotkey; Appearance; Advanced — the menu bar, launch at login, the organisation, the reader, the CLI.) (1.3: Client folders gives each folder an In sidebar switch beside Internal, both columns headed, and Remove; Add a folder… under the list; a Removed list with Restore when any folder is removed.) (1.12, Firstmate, current: Crew's prerequisites line names `perl`, and after the tools table comes a Table **Firstmate options** — Park on review, Fleet ledger, Lane capacity — each with a status badge in the tool table's way: `on` (solid `--ok`), `off` (solid `--stale`), `cap 4` or `auto` (solid `--ok`), `checks quota — Kinas does not run it` (solid `--warn`), `invalid` (solid `--danger`), then one quiet line: "Turn these on or off by asking the first mate." Before setup the card has no options table.)

*1.13 (the interface polish):* two columns inside the page, the window's sidebar unchanged. On the left, a search field and the groups, each under a group label (2.5): Providers (Claude Code, Ollama Cloud, Convex, Hostinger VPS), Crew (Firstmate), Workspace (Projects folder, Client folders, Organisation), Interface (Appearance, Keyboard shortcuts, Global hotkey, Menu bar, Reader), System (Launch at login, kinas CLI); a click scrolls to the section, and the section in view is selected. On the right, each section's **Settings rows** in one card. Typing in the search keeps only the rows whose label or description matches, and their sections; with none, "No setting matches "x"." The Claude Code connection's three shell lines fold behind "Show the lines" while its status is receiving, and stay open while it is not.

**Launch screen (CLI).** The one place `--font-display` and the block-letter wordmark appear. Its panel uses the same status words and freshness rule as the app.

**iPhone.** Four screens:

- **Home:** Overnight rows, the waiting count, and the three gauges as metric rows.
- **Inbox:** the list of items.
- **Task detail:** a plan or a PR, with summary, checks, diff stats, and the pinned actions.
- **Launch:** the launch form, as a sheet.

## 6. Writing on screens

Sentence case everywhere. No abbreviation a newcomer would not know: write "Database I/O" and "Function calls", not "Fn calls". Units follow the number in `--ink-2`. Times are relative when under an hour ("3 h 43 m") and absolute otherwise, always with the timezone if not local. Errors say what happened and what to do, in one line, in plain words. Never "Oops", never an exclamation mark. Buttons name the action, and the result repeats it: Approve plan leads to "Plan approved". (1.13, the interface polish: a reset reads relative within 24 hours — "resets in 1 h 59 m" — and absolute beyond — "resets Thu 2 Oct, 12:43" — on the clock the Usage page uses, with the other form as its tooltip, on Home, on Usage and in the Usage popover. A task's elapsed time in the sidebar is its largest unit only — "41 min", "1 h", "2 d" — with the full time as its tooltip.)

## 7. Accessibility

- **Focus:** a 2 px `--accent` ring outside the element, always visible when navigating by keyboard.
- **Contrast:** as measured in 2.4, in both themes and at any brand accent.
- **Words with color:** everything a color says, a word also says.
- **Hit targets:** at least `--hit` on the Mac and `--hit-touch` on the phone.
- **The terminal:** exempt from the ring, because it owns its keys and its focus is shown in its chrome.

## 8. Theming the open-source build

- A user overrides only the brand layer (2.1), through Settings, Appearance. Kinas stores it in the user's config, not in the repo.
- **Accent:** any color. Kinas derives `--accent-soft` and the dark accent from it and runs the contrast checks from the Accent field before saving.
- **UI font:** any family. It falls back to the system stack.
- **Mono font:** must have tabular figures and must distinguish 0 from O and 1 from l. Otherwise Kinas falls back to the default.
- **Display font:** used only for the wordmark and launch screen.
- Nothing else is overridable: surfaces, ink, status, category, spacing, radius, and motion are how Kinas communicates, and changing them changes meaning.

## 9. How agents use this

- `DESIGN.md` at the repo root is the law, beside `keymap.md`. A PRD's UI section names components from section 4. If a component is missing, the PRD adds it here first.
- Tokens live in `app/src/styles/tokens.css` (amended 1.2: hand-written, held equal to section 2 by `app/src/styles/design.test.ts`; `design/tokens.json` and its generator arrive with the phone, whose native app needs `KinasTokens.swift`). Components live in `app/src/ui/<Component>.tsx` with a sibling `.css`, one story per state in `app/src/ui/stories/`, exported from `app/src/ui/index.ts`; a page imports from there and nowhere else. Pages compose components and add no styles of their own beyond layout, which uses the layout tokens.
- A test greps `app/src` for raw hex colors, raw `px` sizes, and raw spacing values outside the generated tokens, and fails on any.
- Every story renders in both themes at the default accent and at one extreme test accent. A test checks contrast on every text pair.
- Screenshots of every page, in both themes, on the Mac window and the iPhone width, are part of the smoke test. A design regression is a visible diff, not a feeling.
- When this file changes, the date and the reason go in Changes at the top, never a rewrite of history.

### Adding a surface

The procedure every later build follows, in this order (added 1.2, 2026-09-22):

1. **Read this file first**, then `keymap.md`. A PRD's screens line names the components from section 4 the surface composes.
2. **Reuse a component, or add one here first**: a state or a component that section 4 does not describe is written into section 4 — its anatomy, its states, its tokens — before any code, then built in `app/src/ui/` with a story per state, then used.
3. **Mock the screen** as plain HTML from `tasks/_templates/mockup.html` (it inlines this file's tokens from `tokens.css`) under `tasks/<feature>/mockups/`, using only semantic tokens and section 4's components, and **review it in the reader** with `kinas open tasks/<feature>/mockups/<screen>.html`; iterate until the captain says "yes, that". Where this file and the mockup disagree, this file wins and the mockup is corrected before Gate 1 is approved.
4. **Build**: the page composes `app/src/ui/` components and adds layout only; the guard test (`app/src/styles/guard.test.ts`) refuses any raw colour, font size or spacing outside `tokens.css`; the contrast test holds every text pair in both themes; the story renders every state.
5. **Update `design/preview.html`** when a token or a component changed, so the preview and the app never drift (`app/src/styles/preview.test.ts` holds their tokens equal); add the page to `docs/design/screens/` in both themes.

An agent starting the Crew page with no memory of this file's authors should find `Lane`, `Card`, `InboxItem`, `StatusBadge` and `TerminalChrome` in `app/src/ui/` with stories, mock the board from the preview, and ship a page that looks like it was always there — without asking a design question.

## 10. Migration of what exists

Each step ships when its definition of done holds, not on a date. (1.2, 2026-09-23: steps 1–6 are done in the design-system build — step 1 with `tokens.css` hand-written and held to section 2 by test instead of a `tokens.json`, and step 6's grep test is the guard, with one sheet still on a ratchet: `reader.css`, the document's prose rhythm, 29 raw values. Step 7 is the phone.)

1. **Tokens.** `tokens.json` with both layers and both themes, generating `tokens.css`. Done when the contrast test passes on every pair in 2.4, in both themes.
2. **Core components.** Button, Gauge, Metric row, Section header, Status badge, Progress row, Inbox item, and Table. Done when each has a story rendering in both themes.
3. **Home.** Done when a screenshot shows overnight progress for every folder under `clients/`, the waiting items, and the usage section, in both themes.
4. **Usage rebuild.** Hero row, provider sections, chart by provider, and tables for today and the month. Done when the page answers "what is left" without scrolling on a 13-inch screen.
5. **Restyle.** The sidebar, reader header, Settings (with Appearance and the Accent field), and the palette. Done when none of them uses a value outside the tokens.
6. **Retire the old look.** All-caps mono labels, corner dots, and raw values. Done when the grep test passes with zero exceptions.
7. **iPhone.** The tab bar, Home, Inbox, Task detail, and Launch. Done when a plan approval, a PR approval, and a task launch each work end to end from the phone.

## Open items

- ~~Whether Clash Display's license permits bundling it in the open-source repo (2.5).~~ Closed 1.2: it does not; Bricolage Grotesque.
- Whether the iPhone app is native Swift or web, which decides the token delivery (3.3).
- ~~Assumed: each folder under `clients/` is one Crew lane, and internal projects sit beside them marked "internal". Confirm.~~ Closed 1.4: a lane is a client folder — any folder the sidebar lists, internal ones included, marked as they are there — matched to a crew project by their GitHub repository.
