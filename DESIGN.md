# DESIGN.md · The Kinas design system

The law for how Kinas looks, the way `keymap.md` is the law for keys. An agent building any surface reads this first, uses only what it defines, and adds to it before using anything it does not define.

Version 1.3, 2026-09-23.

## Changes

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

Category (identity only: folders, providers)
--cat-1         #3E7C8A   teal
--cat-2         #7A62B0   violet
--cat-3         #8A6A4E   walnut
--cat-4         #6B6F2A   olive
--cat-5         #A8527A   rose
--cat-6         #4E5F8C   slate

Terminal (the pane's own palette, never used outside it)
--term-bg       #F4F2EC   light; #10192B dark (amended 1.2: the pane follows the theme)
--term-fg       #0A1420   light; #E7EEF7 dark
--term-selection #CCDDEC  light; #18406B dark
--ansi-*        sixteen colours, a set per theme, every one ≥ 4.5:1 on its --term-bg; --ansi-black = --line,
                --ansi-bright-black = --ink-2, --ansi-yellow = --warn, --ansi-bright-white = --term-fg

Floating layers only
--shadow-float  0 8px 24px rgb(20 23 30 / .12), 0 1px 3px rgb(20 23 30 / .08)
```

Rules:

- **Accent** marks the interactive and the selected. It is never a bar fill, a status, or a category.
- **Status colors** appear as dots, bars, and segments. They are never text, with one exception: `--danger` for an error message (5.7:1 on `--surface`).
- **Category colors** appear as a chip or a chart series, always next to the name they stand for. Each client folder and provider gets one in Settings, and it stays stable. Past six, colors repeat and the name disambiguates.
- **Bars** fill with `--meter` when fine, `--warn` past 80 %, `--danger` past 95 %, and `--stale` when the reading is older than its window. (1.2: these replace the app's earlier ≤ 25 / ≤ 10 % *left* rule; a dead reading draws no bar.)
- **The brand's gold and crimson** appear only as `--warn` and `--danger`.

### 2.3 Color, dark theme

Same token names, swapped values. Never a second stylesheet.

```
--bg #14171E   --surface #1B1F27   --surface-2 #232833   --line #2B3140   --line-strong #3A4152
--ink #EDEEF2  --ink-2 #A1A7B4     --ink-3 #6E7482
--accent       color-mix(in oklab, var(--brand-accent), white 32%)
--accent-ink   #0E1420
--accent-soft  color-mix(in oklab, var(--accent) 18%, var(--surface))
--meter #A1A7B4  --meter-track #2B3140
--ok #4FB37A   --warn #D9A03A   --danger #E5575E   --stale #7C818D
--cat-1 #5FA3B2  --cat-2 #9D88D6  --cat-3 #B08E70  --cat-4 #A3A85A  --cat-5 #CF7AA0  --cat-6 #7688B8
--shadow-float 0 8px 24px rgb(0 0 0 / .4), 0 1px 3px rgb(0 0 0 / .3)
```

`--accent-ink` flips to dark because white on the lightened accent drops to about 3.4:1. Amended 1.2 (2026-09-22): the terminal palette *does* change — the pane draws on the window's ground in both themes with the ANSI set of that theme (decided with the light theme of PR #22); a program that paints its own 24-bit theme does not follow.

### 2.4 Contrast (measured, WCAG 2.x)

| Pair | Light | Needs |
|---|---|---|
| `--ink` on `--bg` | 14.7:1 | 4.5 |
| `--ink-2` on `--bg` | 5.5:1 | 4.5 |
| `--accent-ink` on `--accent` | 7.6:1 | 4.5 |
| `--danger` text on `--surface` | 5.7:1 | 4.5 |
| `--ok` dot on `--bg` | 3.8:1 | 3 |
| `--warn` dot on `--bg` | 3.2:1 | 3 |
| `--stale` bar on `--bg` | 3.5:1 | 3 |
| `--ink-3` on `--bg` | 2.9:1 | non-essential only |

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

iPhone scale (px / line-height) — --m-fs-<step> / --m-lh-<step>
--m-text-sm      13 / 18    captions, badges, tab labels
--m-text-body    15 / 22    body, rows, buttons
--m-text-title   20 / 26    screen titles below the large title
--m-text-large   28 / 34    the large title

Weights: 400 regular, 500 medium, 600 semibold. Nothing bolder.
```

Rules: labels are sentence case, never all caps, never letter-spaced. Numbers are always mono with tabular figures, right-aligned in tables, and carry their unit in `--ink-2`. Mono is for numbers, code, paths, keys, and the terminal. It is never for labels or prose.

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

The sidebar holds, top to bottom: the wordmark, the navigation (Home, Work, Crew, Inbox with its count, Usage), what can be opened (Pinned, the open folder's files), the client folders with their category chips, Recent, the shell's last notice, one line for the VPS connection, and Settings, the last row. It collapses with the key defined in `keymap.md`. The proposed key is ⌘\, because ⌘S means save wherever the Reader edits.

(1.3, folder views.) There is no Reader row: every file and folder row opens the reader, and × closes it. A client folder is **shown**, **hidden** (off the sidebar and Home, still in Settings' list with its In sidebar switch off) or **removed** (off Settings' list too, in its Removed list with Restore; nothing on disk is touched). A right-click on a client folder opens a Menu: Hide from sidebar, Add a client folder…, then Show for each hidden folder; on the heading, the same without Hide. An added folder is any folder inside the projects folder, git or not. Colours are seated over every folder, hidden and removed ones included, so hiding one never repaints another.

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
| StatusBadge | queued, working, blocked, red, done, stale, dead, decision, pr, ready, counted |
| Dot | solid, ring, cross |
| Chip | cat-1, cat-2, cat-3, cat-4, cat-5, cat-6 |
| Tag | internal, order |
| Gauge | fine, warn, danger, stale, dead |
| Bar | fine, warn, danger, stale, inline, segmented |
| MetricRow | rows, attention |
| SectionHeader | reading, activity, info, plain |
| TitleRow | home |
| Table | today |
| Card | plain, selected |
| Lane | with-cards, empty |
| ProgressRow | list, quiet |
| InboxItem | plan |
| Timeline | task |
| Toast | success, error |
| EmptyState | with-action, plain |
| TerminalChrome | working, shell |
| Panel | task-detail |
| Nav | sidebar, folder-icons, reader-icons, connection-states |
| Menu | plain, disabled, divider |
| Field | text, secret, switch, accent |
| Section | usage |
| Badges | row |

**Button.** Three kinds: primary (`--accent`, `--accent-ink`), secondary (`--surface`, 1 px `--line-strong`, `--ink`), and text (`--ink-2`, no border). Height is `--hit` on the Mac and `--hit-touch` on the phone. The label names exactly what happens ("Approve plan", not "Submit"), and the toast that follows uses the same verb.

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
| ready | ring | `--ok` |

When counting, the number comes first in mono ("4 done").

**Progress row (new).** One row per client folder, `--row-h-progress` tall. It holds:

- the folder's category chip and name (`--text-md`, 500);
- one line in `--ink-2` with the latest event and its time;
- a 4 px segmented bar showing done (`--ok`), working (`--meter`), waiting on a person (`--warn`), and failed (`--danger`);
- count badges for non-zero states only;
- a chevron.

Selecting a row opens that folder's most important task in the right panel: the one waiting on a person first, then the failed one, then the latest. A folder with no overnight activity shows "No work overnight" in `--ink-2` and no bar. Internal folders carry an "internal" badge and sort last.

**Card.** `--surface`, `--radius-md`, 1 px `--line`, 16 px padding. Selected: an `--accent-soft` background and a 2 px `--accent` left edge.

**Table.** For lists that are read, not browsed. The header is in `--text-sm` `--ink-2`. Rows are `--row-h`, numbers are right-aligned mono, hover is `--surface-2`. No zebra stripes, no vertical lines.

**Timeline.** A vertical list with the time on the left (`--text-xs` mono, `--ink-2`), a status dot, and the text. Orders from the captain carry a small "order" badge.

**Inbox item.** The question in `--text-lg`, the evidence as a collapsed section, the recommendation in one line, and three actions: Approve (primary), Answer (secondary), Deny (text). On the Mac the keys are A, R, and D when the item is focused. There are two variants:

- **Compact (Home):** the question in `--text-md` 500 with the folder chip, the recommendation in `--ink-2`, and the actions inline.
- **Phone:** the actions pinned to the bottom of the screen at `--hit-touch`.

**Lane.** A column on the Crew board with one lane per client folder. The header holds the folder name, its category chip, and the provider slots as "Claude 1/1 · Codex 1/2" in mono. Task cards follow. An empty lane shows one line of quiet text.

**Terminal chrome.** A `--chrome-h` bar above the pane in `--surface-2`. It holds the session name, a status badge, and the profile, with Detach and Copy on the right. The pane uses the terminal palette, and nothing else in the app does. (1.2, as built: a sibling above the pane, never around it, rendered from the first frame so the terminal is never remounted; the session is `default`, a debug build's test session, or a plain shell (badge stale, "plain shell"); Copy copies the pane's selection as a mouse copy does. Detach waits for a Herdr-CLI door.)

**Reader header.** As built: file name, Rendered/Source toggle, Copy, the ▾ menu, Expand, and Close, in `--text-md` with `--ink-2` icons. (1.2: on the tokens, `--hit` tall, its six icons drawn on the 16 grid in `app/src/ui/icons.tsx`; it stays the reader's own, not a library component.) (1.3: its ▾ menu is the library's Menu.)

**Menu (1.3).** A `--surface` sheet with a 1 px `--line` border, `--radius-md` and `--shadow-float`, one item per action in `--fs-md` `--ink`; the focused or pointed item sits on `--line`, and an item that cannot be used stays in place in `--ink-2` with the reason as its tooltip. A divider is 1 px `--line` and the arrows skip it. It takes focus when it opens and gives it back when it closes, so nothing typed at an open menu reaches the terminal (keys in `keymap.md`). Its place is the caller's: under the reader's ▾, at the pointer for the client folders' right-click.

**Palette.** A floating layer with a single input and a list. Matches show in `--accent`, and it has `--shadow-float`.

**Settings field.** The label above, the control below, and help text in `--ink-2`. Secrets are write-only fields with a "Stored in Keychain" caption. Groups are cards. (1.2, as built: in Settings each group's title is the label of the one control or the row of controls it holds.)

**Accent field (new).** A color control in Settings, Appearance. It shows the contrast of `--accent-ink` on the accent in both themes. If either is under 4.5:1, it offers the nearest passing shade and will not save the failing one.

**Tab bar (new, phone).** Four tabs with icons and `--m-text-sm` labels. The current tab is in `--accent`, the others in `--ink-2`. The Inbox tab shows its count.

**Launch form (new).** Used on the phone and in the Mac palette. It has four fields:

- the folder, as a picker showing category chips;
- the brief, as a text field;
- the provider, as a segmented control showing free slots ("Codex 1 of 2 free"), with full providers disabled;
- "Ask for a plan before building", a switch that is on by default.

It ends with one primary button, Launch task.

**Switch (new, phone).** 51 × 31 pt. On is `--accent`, off is `--line-strong`.

**Empty state.** One sentence in `--ink-2` and one action. Never an illustration.

**Toast.** Bottom center, 3 s, one line, one optional action. Success has no color; only errors use `--danger`. (1.2, as built: the placement is the caller's — the terminal's "copied to clipboard" sits in the pane's corner, clear of a prompt; the sidebar's notice at its foot.)

## 5. The pages

**Home (new, the first screen).** It answers one question: what happened while I was away, and what needs me. The page has a title row and three sections:

- **Title row:** "Home", the waiting count as a secondary button that opens the Inbox, and Launch task (primary).
- **Overnight (the hero):** one progress row per folder under `clients/`, with internal folders last. The caption says "since" followed by the end of your last session on any device, capped at 24 hours.
- **Waiting on you:** up to three compact inbox items, newest first, with "All 5 in Inbox" when there are more.
- **Usage:** the three gauges that decide the day, compact. Below them is a "Needs attention" list of metric rows for anything in `--warn`, `--danger`, or stale across Convex, the Hostinger VPS, Ollama, and this Mac. When nothing needs attention, one line says "Everything else is within limits." The caption is "as of" the oldest reading shown.

*As built (1.2, 2026-09-23):* the waiting count button arrives with the Inbox (its count is zero until the crew). Overnight has no caption until an event log exists, and each folder says "No work overnight in this folder."; a row opens the folder in the reader. (1.3: only shown folders are listed; with every folder hidden, the empty state says Settings → Client folders shows them again.) Waiting on you is the empty state. Needs attention lists every reading at 80 % used or more, stale or dead, every configured reader in error (once, with its reason), and this Mac's memory or disk past 80 % — never a CPU; danger first. Launch task goes to the Work page with the terminal holding the keys.

**Usage.** It answers: how much of what we pay for is left. It opens with a hero row of the three gauges, larger. Below that comes one section per provider, each with its plan name and a single freshness caption:

- **Claude:** model usage as a chart.
- **Ollama:** credits, concurrency, and requests by model as metric rows.
- **Convex:** nine metric rows, with the month caveat as an info icon on the section header.
- **Hostinger VPS:** state, uptime, CPU, memory, disk, and network as metric rows.
- **This Mac:** three metric rows.

Chart bars are colored by provider category and the legend lists providers only; models appear in the tooltip and in "Show as table". "Today" and "Month to date" are tables inside each provider's section.

*As built (1.2, 2026-09-23):* the hero is Claude's week and session and Ollama's first window. Ollama's other windows are metric rows and its requests per model a table per window. Convex's rows read "250,000 calls of 1,000,000 calls · 25% used", the window said once as the rows' title, today's figures and the metrics without an allowance in their own cards. The VPS is one card named for the machine (`hostname · plan · state`), its live state rows without bars and its month's traffic a figure. The chart and its Today and Month to date tables (per harness · model) sit in the Claude section, since the transcripts they read are the coding harnesses'.

**Work.** The terminal pane fills the page under its chrome. The launch screen inside it keeps the wordmark and the situation panel, with labels following the type rules. The folder lanes and the review queue sit in a collapsible strip above the pane (`--strip-h`), hidden with the key in `keymap.md`. (1.2: the chrome is built; the strip arrives with the crew.)

**Crew.** A board with one lane per client folder, cards inside, and the inbox count in the title row. Task detail opens in the right panel with the brief, the plan, the timeline, the PR checks, the report link, and the session button.

**Inbox.** Inbox items, newest first, with the count in the sidebar.

**Reader.** As built. Only the header follows the component above, and the body uses the type scale.

**Settings.** Cards per group: Providers, Crew, Client folders (category colors), Shortcuts, Appearance (theme, accent field, fonts), and Advanced. The tool health list from the crew installer is a table with status badges. (1.2, as built: a card per existing group, in order — the Claude Code connection, Ollama, Convex, Hostinger, shortcuts, the global hotkey, Appearance with the Accent field, the menu bar, launch at login, the organisation, the projects folder, Client folders, the reader, the CLI; the grouping into Providers/Crew/Advanced comes with the crew.) (1.3: Client folders gives each folder an In sidebar switch beside Internal, both columns headed, and Remove; Add a folder… under the list; a Removed list with Restore when any folder is removed.)

**Launch screen (CLI).** The one place `--font-display` and the block-letter wordmark appear. Its panel uses the same status words and freshness rule as the app.

**iPhone.** Four screens:

- **Home:** Overnight rows, the waiting count, and the three gauges as metric rows.
- **Inbox:** the list of items.
- **Task detail:** a plan or a PR, with summary, checks, diff stats, and the pinned actions.
- **Launch:** the launch form, as a sheet.

## 6. Writing on screens

Sentence case everywhere. No abbreviation a newcomer would not know: write "Database I/O" and "Function calls", not "Fn calls". Units follow the number in `--ink-2`. Times are relative when under an hour ("3 h 43 m") and absolute otherwise, always with the timezone if not local. Errors say what happened and what to do, in one line, in plain words. Never "Oops", never an exclamation mark. Buttons name the action, and the result repeats it: Approve plan leads to "Plan approved".

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
- Assumed: each folder under `clients/` is one Crew lane, and internal projects sit beside them marked "internal". Confirm.
