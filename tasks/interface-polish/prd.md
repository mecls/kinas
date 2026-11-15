# The interface polish — Implementation Spec

*2026-11-15. Written from the captain's comparison of Kinas with ten screenshots of Orca, an agent IDE whose look they
like, and their answers to four questions (§7). Kinas's way of working stays exactly as it is; what changes is how it
looks and how quickly things are found. To be built from `origin/main` at `0f63948`. It amends DESIGN.md (to 1.11)
before any code, and adds no key chord.*

## 1. Objective

Kinas works the way the captain wants: Home says what happened and what needs them, the crew has a board, the Inbox
has keys, the reader sits beside every page. But next to the reference app it looks flat and it hides things. The
dark theme is blue-tinted where the reference is a clean neutral. Every row is the same weight and grey, so nothing
leads. Keys exist but are nowhere on screen. The ⌘K palette is a list of eleven command names that finds no file,
task or setting. Settings is one long column of cards that opens with three shell lines. Usage is out of sight on the
Work page, where most of the day is spent, and the sidebar does not show which folder has an agent working. This
change takes the reference app's look and reach — neutral dark, names that lead, keys in view, one search for
everything, live folders, usage in a status bar, a Settings you can navigate, line counts on changed files — and fixes
six Kinas faults found on the way. No page, flow, key or command is taken away or changes meaning.

## Announcement

Kinas has a new coat. The dark theme is a calm neutral gray, and in both themes names now lead every list, with the
details quiet beneath them. ⌘K finds everything: files, folders, crew tasks, inbox items, Herdr workspaces, settings
and commands, with the keys for each shown beside it. The sidebar shows which client folder has an agent working or
waiting on you, and a status bar along the foot of the window keeps your usage limits in view on every page. Settings
has a section list and a search, and every changed file in a tree says how many lines it gained and lost. The light
theme you know is unchanged.

## 2. Business rules (invariants — never violate)

**Nothing about how Kinas works changes**

1. **No flow is lost or changed.** Every page, key, menu entry, palette command and click that exists today still
   exists and does the same thing. The palette gains results and loses no command; the sidebar gains a search row and
   live marks and loses only the connection row, which moves to the status bar (rule 22) and keeps its click.
2. **No new chord.** This change adds no key binding and changes none in `keymap.md`. It only shows the chords that
   exist (rule 9). The palette keeps its keys: typing, ↑ ↓, Enter, Esc.
3. **The terminal pane is untouched.** Every key without ⌘ still goes to the PTY; nothing added here takes focus or a
   key from the pane unless clicked; the pane's process survives every change here, as every pid assertion in the e2e
   suite already holds.
4. **Same sources, read the same way.** Every new surface reads what Kinas already reads — the usage poller, the
   crew's mirror, Herdr's socket, the file trees, the settings — on the cadences it already has. Nothing new is fetched
   and nothing leaves the Mac.

**The dark theme (answer 2A)**

5. **Light stays exactly as it is.** Every light-theme token keeps its value; the design test holds each one to the
   value it has today. The captain works in the light theme.
6. **Dark becomes neutral.** The dark surfaces and text lose their blue: `--bg #0F0F0F`, `--surface #171717`,
   `--surface-2 #212121`, `--line #272727`, `--line-strong #363636`, `--ink #EDEDED`, `--ink-2 #A3A3A3`,
   `--ink-3 #6E6E6E`, `--meter #A3A3A3`, `--meter-track #272727`, `--scrim rgb(0 0 0 / .6)`. The accent, status and
   category colours keep their dark values. The terminal follows the theme as it does today: `--term-bg` becomes the
   new `--bg`, `--term-fg` the new `--ink`, and `--ansi-black` and `--ansi-bright-black` stay equal to `--line` and
   `--ink-2`.
7. **Every contrast pair still passes.** Each pair in DESIGN.md §2.4 is measured again on the new values and meets its
   threshold. Measured for this spec: `--ink` on `--bg` 16.4:1, `--ink-2` on `--bg` 7.6:1 and on `--surface-2` 6.4:1,
   `--danger` on `--surface` 5.0:1, `--stale` on `--bg` 4.9:1, `--ink-3` on `--bg` 3.8:1 (non-essential only); every
   ANSI colour stays at least 4.5:1 on the new `--term-bg`.

**Type and hierarchy (answer 3A)**

8. **Uppercase is for group labels, and only there.** A label that heads a group of rows — the sidebar's Pinned and
   Client folders, the palette's groups, the Settings section list's groups — and a table's column headers are set in
   capitals: `--fs-xs`, weight 600, letter-spaced, `--ink-2`. Everything else stays sentence case: page and section
   titles, buttons, rows, captions. A name (a folder, a file, a task) is never put in capitals. DESIGN.md §2.5 is
   amended to say so.
9. **Every chord is shown where its action is.** A palette row for a command shows its chord; a menu item with a
   chord shows it at the right; a sidebar nav row shows its chord (⌘1 to ⌘5) while pointed at or focused, and Settings
   shows ⌘, the same way; the sidebar's search row always shows ⌘K. A chord is drawn as a **Keycap**. The chord shown
   is the one bound now — Settings → Keyboard shortcuts can rebind six of them — never a written-in default.
   *(Clarified at Gate 2, 2026-11-15: the Keycap is the existing `Kbd` of DESIGN.md §4's Button "hint", given a
   `--surface-2` fill; there is no new Keycap component.)*
10. **The name leads every row.** In every list row — sidebar rows, Overnight rows, crew cards, inbox items, palette
    rows, Settings rows — the thing's name is `--ink` at weight 500; everything else on the row is `--ink-2` at 400.
    A row's details sit on one line joined by " · " and end in an ellipsis when they do not fit; a row never wraps.
11. **An empty state is a line, not a box.** "Nothing waiting on you." is `--ink-2` text where the content would be,
    with its action beside it when it has one. No dashed border, no card.

**The palette finds everything**

12. **One box, three doors.** ⌘K, the global hotkey and the sidebar's new search row open the same palette. Its
    placeholder reads "Search files, folders, tasks, workspaces, settings and commands".
13. **What it searches.** Eight kinds, shown as groups in this order, each hidden when it has no match:
    - **Commands** — the eleven commands of today, with their chords.
    - **Open** — the reader's tabs this session.
    - **Files** — files and folders under the projects folder, found by name as `kinas open` finds them, and never
      outside it.
    - **Client folders** — the folders the sidebar lists, hidden ones included and marked hidden.
    - **Tasks** — the crew's tasks the Crew board shows now.
    - **Inbox** — the items waiting on the captain.
    - **Workspaces** — Herdr's workspaces, from the view of Herdr the crew already keeps.
    - **Settings** — every Settings row, by its label and its description (rule 33).

    *(Clarified at Gate 2, 2026-11-15: Files walks the projects folder as `kinas open` searches it — names starting
    with a dot and `node_modules`, `target`, `dist`, `build`, `Pods` skipped, 8 folders deep — up to 200,000 entries;
    past that the Files group says only the first 200,000 are searched.)*
14. **What an empty box shows.** Before anything is typed: **Recent** — the last eight things opened anywhere in Kinas
    (a file, a folder, a task, a workspace, a setting), newest first, kept across a relaunch — then **Commands**.
15. **Matching.** Case-insensitive and accent-insensitive (so "reuniao" finds "reunião", however the Mac stored the
    name). A match at the start of a word ranks above one inside a word; a name match above a path match. Each group
    shows its five best, then "N more", which opens the group in place. *(Clarified at Gate 2, 2026-11-15: accents
    fold without a new library — precomposed Latin letters and combining marks both fold to the base letter.)*
16. **What Enter does.** A command runs as it does today, its output shown in the palette. A file or folder opens in
    the reader, as `kinas open` would. A client folder opens in the reader, as its sidebar row does. A task opens its
    detail in the right panel. An inbox item opens the Inbox with that item selected. A workspace opens the Work page
    on it, as a folder's terminal button does. A setting opens Settings scrolled to its row, with its control focused.
    Esc closes and focus returns to whatever had it, the terminal included, as today.
17. **A row says what it is.** Every row carries the kind's icon, the name (matched letters in weight 600), one line of
    detail — a file's path under the projects folder in mono, a task's status word, an item's age — and on the right
    the client folder's chip and name when it belongs to one, and the Keycap when it has a chord. The palette's foot
    lists its keys: ↵ Open · Esc Close · ↑↓ Move.
18. **A slow or failed source never blocks the rest.** Commands answer at once. A group still being read says so in
    one line ("Indexing files…"); a group whose source failed says why in one line ("Herdr is not running"); every
    other group works. After the first search the file index answers within 100 ms on the captain's projects folder.

**The sidebar**

19. **A search row.** Under the wordmark: a magnifier, "Search", and the ⌘K Keycap. A click opens the palette.
20. **Live client folders.** A client folder's row shows, at its right, the crew's most pressing word for that folder
    and a count, from the same mirror and the same words as the Crew board: **needs you** (needs decision, ready — a
    `--warn` ring), else **failed** (failed, blocked, CI red — a `--danger` dot), else **working** (queued, working, PR
    open, paused, unknown — a neutral dot). A folder with nothing in flight shows nothing. The word is always written
    beside its dot.
21. **What is in flight, underneath.** Below a folder with work in flight, up to three tasks, one line each: the dot,
    the task's title and its elapsed time in its largest unit only ("41 min", "1 h", "2 d", so the title keeps the
    room; the full time is the tooltip); then "N more" when there are more. A click on a task opens its detail; on
    "N more", the Crew page. Done and gone tasks never show here.
22. **The connection row leaves the sidebar.** The VPS line moves to the status bar (rule 24); the sidebar ends with
    Settings.

**The status bar**

23. **One row along the window's foot.** Below the three columns, across the whole window, `--hit` tall, on `--bg`
    with a `--line` along its top, on every page, with the sidebar hidden and in full screen. It is part of the
    window, like the title bar; nothing in it moves the terminal.
24. **What it shows.** On the left, the same readings as Home's three gauges, each as its name and its percent used
    ("Claude session 97%"), with its tone's dot only when it is warn, danger or stale. On the right, the crew's counts
    ("2 working · 1 needs you", hidden before the crew is set up) and the VPS connection ("Hostinger VPS · connected",
    with its dot). With no provider configured, the left says "No usage readings — Settings → Providers".
25. **The usage popover.** A click on the readings opens a floating sheet above them: one block per configured
    provider, its name and a single "as of" time, and per window a bar, "24% used" on the left and its reset on the
    right; at its foot "Open Usage" with its Keycap. Esc or a click outside closes it and focus returns. A click on
    the crew's counts opens the Crew page; on the VPS line, the Usage page at the VPS. *(Clarified at Gate 2,
    2026-11-15: the popover lists Claude's and Ollama's windows and those of Convex's metrics that have an allowance;
    the VPS stays a line on the bar's right, not a block in the popover.)*
26. **The macOS menu bar keeps its figure.** Settings → Menu bar is unchanged; the status bar is the in-window copy.

**Home**

27. **Quiet folders fold into one line.** Overnight keeps a row for each folder with work in its window. Folders with
    none share one line at the end: "No work overnight in" followed by each folder's chip and name, each a link that
    opens it in the reader. With no work anywhere, that line is the whole section.
28. **Needs attention never repeats a gauge.** It lists only readings that are not among the three gauges above it;
    when that leaves none, it says "Everything else is within limits."
29. **A reset says itself once.** Within 24 hours: "resets in 1 h 59 m". Beyond: "resets Thu 2 Oct, 12:43". The other
    form is the tooltip. The same words on Home, on Usage and in the popover. DESIGN.md §6 is amended to say so.

**Usage**

30. **The chart spans the data.** The model chart's days start at the first day with data and span at least 7 days
    and at most the 30 of today; "No data before …" stays while the first day is inside the 30.
31. **Tables use the group-label style for their headers** (rule 8); the figures stay right-aligned mono.

**Settings**

32. **A section list.** Settings becomes two columns inside the page, the window's sidebar unchanged. The left column
    holds a search field, then the groups with their sections:
    - **Providers:** Claude Code, Ollama Cloud, Convex, Hostinger VPS.
    - **Crew:** Firstmate.
    - **Workspace:** Projects folder, Client folders, Organisation.
    - **Interface:** Appearance, Keyboard shortcuts, Global hotkey, Menu bar, Reader.
    - **System:** Launch at login, kinas CLI.

    A click scrolls the right column to that section; the section in view is marked selected while scrolling.
33. **A setting is a row.** Each setting is one row: its label (`--ink`, 500) and a one-line description (`--ink-2`)
    on the left, its control on the right; a section's rows sit in one card with hairlines between. A wide control —
    a path, a key, the client-folder list, the crew's tool table — sits under its label at the row's full width.
34. **Search narrows to rows.** Typing keeps only the rows whose label or description matches, and the sections that
    hold them; with none, "No setting matches "x"." The palette finds the same rows (rule 13).
35. **The shell lines fold away once they work.** The Claude Code connection's three lines and their Copy buttons sit
    behind "Show the lines" while the status is receiving, and stay open while it is not.

**Files**

36. **A changed file says how much changed.** In a file tree, a file with the captain's own change shows its added
    and removed line counts before its Change mark — "+11 −173", mono, `--fs-xs` — counted as its Diff counts them.
    An added file shows only "+N", a deleted one only "−N"; a binary file, a folder's roll-up and a crew mark show no
    counts. The sign is always written, so the count reads without its colour. When a row is too narrow for both, the
    counts give way before the name is cut; the row's tooltip always says them. *(Clarified at Gate 2, 2026-11-15:
    counts are taken when the mark is judged, within 100 ms per file; a file Kinas keeps no copy of — over 4 MB, past
    the copy budget, an image — or slower than that shows its mark without counts, and its tooltip says why.)*
37. **Count colours are text tokens.** "+N" is green and "−N" red, through two new text tokens that reach 4.5:1 on
    `--bg` and `--surface` in both themes (measured for this spec: light `#1E7048` 5.4:1 and `#B0222A` 6.0:1 on `--bg`;
    dark `--ok` 7.4:1 and `--danger` 5.4:1). DESIGN.md §2.2's "status colours are never text" gains this exception.

**Records**

38. **DESIGN.md first.** DESIGN.md 1.11 is written before any code: the dark values and §2.4's measurements, §2.5's
    capitals rule, §3.1's sidebar and status bar, the new components in §4 (StatusBar, UsagePopover,
    PaletteGroup and PaletteRow, SettingsNav and SettingsRow, LineCounts), §5's Home, Usage and Settings, §6's reset
    wording. `keymap.md` gains a note that this change adds no chord, and where the palette's rows and the status bar
    sit in the Tab order. Each new component gets its stories; `docs/design/screens/` is taken again in both themes.

## 3. Flows

**Searching.** The captain presses ⌘K (or the global hotkey, or clicks Search). The palette opens with Recent and
Commands. They type; Commands answer at once, the other groups as their sources answer. A source still loading shows
its one waiting line, a failed one its reason (rule 18). ↑ ↓ move across groups, Enter acts (rule 16) and closes the
palette, unless a command printed output, which stays shown as today. Esc closes and returns focus.

**The status bar.** The usage poller that feeds Home updates the bar; a reading past its window turns stale and its
dot says so. The crew's counts follow the mirror, on its current cadence. A click on the readings opens the popover;
Esc or a click outside closes it.

**Live folders.** Each refresh of the crew's mirror redraws the folders' words and their in-flight lines. When the
crew is not set up or the mirror cannot be read, the folders show no words, and the Crew page says why, as today.

**Settings.** Opening Settings (⌘, or the gear) shows the first section. A click in the section list scrolls to its
section; scrolling updates the selected one. Typing in the search filters rows; clearing it brings every row back.
Opening a setting from the palette arrives scrolled to its row with its control focused.

**Files.** When a file's change is marked, its counts are computed with its mark, from the same baseline. A file the
Diff cannot count (too large, binary) shows its mark without counts.

## 4. Surfaces

- **The window (DESIGN.md §3.1):** the status bar along the foot (StatusBar, UsagePopover, Keycap, Dot).
- **The sidebar:** the search row (Keycap), the nav rows' chords on point or focus, the live folder words (Dot,
  StatusBadge words) and in-flight lines, the capital group labels; the connection row removed.
- **The palette:** groups and rows (PaletteGroup, PaletteRow, Keycap, Chip), its foot legend.
- **Home:** Overnight's quiet line, Needs attention without repeats, the reset wording, empty states as lines.
- **Usage:** the chart's range, the tables' headers, the reset wording.
- **Settings:** the section list and search (SettingsNav), rows (SettingsRow, Field, Switch, Button), the folding
  shell lines.
- **Crew and Inbox:** cards and items with the name leading (rule 10); no change to what they hold.
- **File trees:** line counts (LineCounts) beside the Change mark.
- **Menus:** chords at the right of items that have one (Menu, Keycap).

**Screens** — one per mockup, each with a Light / Dark (new) / Dark (today) switch at the top:
- `mockups/window.html` — Home in the whole window: the sidebar with search and live folders, Home's fixes, the status
  bar, and the usage popover (a switch opens it).
- `mockups/palette.html` — the palette over the window: empty (Recent and Commands) and with "inv" typed.
- `mockups/settings.html` — Settings with the section list, the search and setting rows.
- `mockups/usage.html` — Usage with the chart spanning its data, the reset wording and the tables' headers.
- `mockups/crew-and-files.html` — the Crew page's cards with names leading, a file tree with line counts, and a menu
  with chords.

## 5. Validation

- `bun run check` green: the design test holds every light token at today's value and every dark token at rule 6's;
  the contrast test passes every §2.4 pair in both themes and at the current accent; the guard test finds no raw value
  in a component; each new component's stories exist and `stories.test.ts` holds the catalogue to them.
- e2e, run alone: `palette.e2e` — a file found by name opens in the reader; a task opens its detail; a setting opens
  Settings at its row; Esc returns focus to the terminal and the next key reaches the PTY. `statusbar.e2e` — the bar is
  present on all five pages and in full screen; the popover opens and closes with Esc; the pane's pid is unchanged
  throughout. `home.e2e`, `usage.e2e`, `folders.e2e`, `tree-changes.e2e` and `shell.e2e` updated for rules 20–22,
  27–31 and 36, and green.
- A timing: after the first search, ten searches for file names over the captain's projects folder each answer in
  under 100 ms (rule 18), logged by a debug build.
- By eye, against the mockups, in both themes: `docs/design/screens/` retaken, and the smoke test's screen lines.

## 6. Out of scope

- **Terminal and browser tabs, the "+" new-tab menu, an embedded browser.** Herdr owns the terminals; the reader owns
  files.
- **An agent session history and a git panel** (commit, publish, create PR). Kinas reads git and never writes it from
  the window; both would be features of their own.
- **Provider and project logos.** They are trademarks and the repository is public; category chips carry identity.
- **The reference app's clutter:** a "primary" chip on every main branch, branch names said twice, "Hiding N
  discovered worktrees" rows, a floating layout button.
- **The light theme's values** (rule 5), **any new chord** (rule 2), and **the iPhone**.
- **A Linear or task-tracker page.** Kinas's tasks are the crew's.

## 7. Open questions

Each has a proposed answer that stands unless the captain changes it at approval.

1. **The status bar is always on** — no setting hides it. (Alternative: a switch in Settings → Interface.)
2. **Up to three in-flight tasks under a folder** in the sidebar (rule 21). (Alternative: the word and count only,
   which keeps the sidebar shorter.)
3. **Settings keeps the window's sidebar** and holds its section list inside the page (rule 32). (Alternative: the
   reference app's way — the sidebar becomes the section list with "← Back to app".)
4. **Recent is anything opened anywhere in Kinas**, kept across a relaunch (rule 14). (Alternative: only what was
   opened through the palette.)

**Asked 2026-11-15, after the comparison, and answered the same day:**

1. What does this pass include? A) the look only; B) the look and the palette's search; C) everything in the
   comparison as one feature. — **C.**
2. The dark theme? A) neutral grays, like the reference; B) keep the blue tint, deepen it. — **A**, "I like our
   current Light mode and I usually use it": the light theme does not change (rule 5).
3. Capital letters? A) allowed for group labels and table headers only, DESIGN.md §2.5 amended; B) sentence case
   everywhere. — **A** (rule 8).
4. Which parts follow as features of their own? — **None**: all of it is this feature.

**The comparison it came from (2026-11-15).** Borrowed, in order of payoff: the palette as one search with groups,
icons, chips and keys; chords shown beside their actions; a neutral dark; names that lead and quiet details; Settings
with a section list, a search and label-description-control rows; live state on each project in the sidebar; usage in a
status bar with a per-provider popover; line counts on changed files. Kinas faults found on the way: Home's one row per
quiet folder; the session gauge repeated under Needs attention; the chart's empty month squeezing two bars to the
edge; the VPS line wrapping in the sidebar; the long reset caption; empty states drawn as dashed boxes.
