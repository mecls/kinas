# The reader's layout, its tabs, and the window's top bar — Implementation Spec

*2026-09-23. Written from the captain's review of the reader, in two rounds (§7).*

- *Round 1 came with two screenshots: the reader at about 875 px with Contents in its fixed 220 px column, and the
  reader expanded on a wide screen with the text stopping at 72ch. Answers: 1A, 2A, 3A, 4A, 5A.*
- *Round 2, given in reply to the first Gate 1 question, came with three screenshots: an editor's tab strip, the
  sidebar's Recent list, and a window whose top bar holds a sidebar icon, ← and →. Answers: 1A, 2A, 3A, 4A, and 5A
  with dragging tabs to reorder them brought into scope.*

*The slug stays `reader-layout`. On `docs/reader-layout-gate-1` from `origin/main` at `1394be7`.*

## 1. Objective

Three changes to how the captain moves around Kinas. They share the reader's header and its Back button, so they
are one spec, but they are built in the order below so that the first can ship before the others.

**Part 1 · The column and the text.** The reader's side column holds Contents, and also Files when the sidebar is
hidden. Today it is always 220 px, and while the reader is 640 px wide or more it cannot be put away. The text
beside it stops at 72ch, about 95 characters of prose, so on a big screen even an expanded reader is a third empty.
After this change:
- Contents and Files hide and show from the header's two buttons at every width.
- The column's edge drags to make it narrower or wider.
- Prose fills whatever width the reader has.
- Kinas remembers the column's state and width across files and relaunches.

**Part 2 · Tabs.** Today the reader shows one file. Opening another replaces it, and the files opened this
session sit in the sidebar's Recent list, which is out of sight whenever Pinned or a client folder fills the
sidebar. After this change:
- Every file opened in the reader gets a tab, as in a code editor.
- The tabs are the recent files, at most 15 of them.
- Recent leaves the sidebar.

**Part 3 · The top bar.** Today the window has the standard macOS title bar. The only Back is the reader's own,
and it walks documents only. After this change:
- Kinas draws its own title bar.
- Beside the traffic lights sit a sidebar icon, doing what ⌘S does, and ← and →, which walk every place the captain
  has been: pages and files alike.
- The reader's own ← goes.

Why now: the captain reads every feature's PRD and build spec in the reader, on a wide screen, several at once,
every day. Each of these three is friction met daily: the screenshots are of this week's first-mate documents.

## Announcement

The reader now works like an editor. Every file you open gets a tab along its top, so you can keep the spec, the
build plan and the README open side by side and click between them, each where you left it; drag a tab to put it
where you want it. Those tabs are your recent files, so the Recent list is gone from the sidebar and the sidebar
has its room back. Contents and Files hide with a click and resize with a drag, and the text fills the reader, so
an expanded reader on a big screen is all reading. At the top of the window, beside the traffic lights, are the
sidebar button and ← and →: they take you back and forward through everywhere you've been, pages and files alike.

## 2. Business rules (invariants — never violate)

### Part 1 · The column and the text

**The two buttons**

1. **Files and Contents are header buttons at every width.**
   - **When each appears:**
     - Contents: whenever the document offers Contents. That condition is the reader PRD's R28, unchanged:
       markdown, taller than the reader, and at least two headings of levels 1–3.
     - Files: whenever the reader draws its own file tree, which means a folder is open and the sidebar is hidden
       with ⌘S.
   - **What stays as it is:** their place (after the path and its badge, before Copy), their icons (folder, list)
     and their `aria-label`s, "Files" and "Contents". The e2e specs find them by those labels.
   - **What goes:** the condition that shows them only while the reader is narrower than 640 px (`NARROW_PX`).
2. **Wide (640 px or more), a button hides and shows its section beside the text.**
   - `aria-pressed="true"` exactly while that section is showing.
   - The tooltip names what a click will do: "Hide Contents" / "Show Contents", "Hide Files" / "Show Files".
   - With one section hidden, the other takes the column's whole height.
   - With both hidden, or with neither offered, the column is gone, and so are its strip and its line. The text
     starts at the reader's own left padding.
3. **Narrow (under 640 px), nothing changes.**
   - A button still opens its section **over** the text, pressed while it is open, 220 px wide, as today.
   - A click while narrow does not touch what is remembered for wide. The overlay is a peek, not a preference.
     If a peek switched off the wide column without saying so, the next wide reader would be missing its Contents
     for a reason nobody could see.

**What Kinas remembers**

4. **Three values, remembered across files, folders and relaunches.**
   - The values and their defaults:
     - whether Contents shows (default: shows);
     - whether Files shows (default: shows);
     - the column's width (default 220 px, `--sidebar-w`).
   - **One set for the whole reader**, never per file, per folder or per tab. If you hide Contents, you don't want
     it on the next file either.
   - **Read at boot, before the window draws.** They are saved beside the divider's `reader_width_pct` and read
     with it through `get_ui_prefs`, so a hidden Contents never flashes open on the first file.
   - **One write per gesture.** A toggle saves on its click. A width saves when the drag ends, or on the
     double-click, and never during a drag. The store's mutex is not reentrant (ADR 0005), and a write per pointer
     move would be hundreds of writes a second. This is the rule `reader_width_pct` already follows.
   - **A failed save is silent.** The screen keeps the choice for the session, exactly as a failed
     `reader_width_pct` save does today.
   - **A bad stored value reads as its default.** That covers a value that is missing, of the wrong type, or out
     of range. A hand-edited setting must never lay the reader out badly, which is the reason the divider's stored
     width is checked the same way.

**The column's width**

5. **Drag the column's right edge to resize it, from 160 to 480 px.**
   - The edge is the 1 px `--line` between the column and the text, and it behaves like the page/reader divider:
     - a resize cursor over a grip a few pixels wider than the line;
     - a 2 px `--accent` line while it is pointed at or dragged;
     - no text selected during the drag;
     - the width follows the pointer live;
     - a cancelled drag keeps the width it reached.
   - **Double-click the edge:** the column goes back to 220 px, and that is saved.
   - **The limits.** At 160 px a level-3 heading, indented 24 px, still shows about fifteen characters. 480 px is a
     little over twice the default, which is room for any heading without letting the column crowd the text.
6. **The text keeps at least 320 px.**
   - If the reader is too narrow for the stored width, the column is drawn narrower, at the reader's width less
     320 px.
   - The stored width is kept, so widening the reader brings it back.
   - A drag stops at the same limit. At 640 px, where the column first appears beside the text, that caps it at
     320 px.
7. **One width, expanded or not.** Expand gives the extra room to the text; the column keeps its width in pixels.
   The narrow overlay stays 220 px (rule 3).
8. **A heading cut short shows whole on hover.** Each row in Contents has the full heading text as its tooltip.
   A narrower column cuts more headings with an ellipsis, and today nothing shows the rest.

**The text**

9. **Prose fills the reader's width.**
   - The 72ch cap on the rendered document goes. Markdown now takes the whole width, as source, preview and image
     files already do. This amends the reader PRD's §4.
   - The reader's own padding stays as it is, and it is the only margin: 18 px at the top, 28 px at the sides,
     48 px at the bottom.
   - Estimated from the screenshot: at the captain's expanded width a line of prose runs to about 140 characters
     with Contents showing, and about 180 with it hidden. Today it is about 95.
   - Tables, code blocks, the frontmatter card, images and diagrams take the width they have, and never more, as
     today.
   - Two cards keep 72ch: "several files match" and "Open a file outside…". They are short prompts with a row of
     buttons, not reading.
   - Print does not change. The print stylesheet already drops every maximum width and hides the column.
10. **Your place survives a reflow.**
    - Whenever the text's width changes, the line at the top of the reader stays at the top, to within one line
      (24 px), and the section highlighted in Contents stays the same. The text's width changes on:
      - Expand and Collapse;
      - dragging the page/reader divider;
      - dragging the column's edge, or double-clicking it;
      - hiding or showing Files or Contents;
      - hiding or showing the sidebar;
      - resizing the window.
    - Why this is needed now: with the 72ch cap, widening the reader rarely reflowed the text, because it was
      already at the cap. Now that prose fills the width, every one of those gestures reflows it. In a
      300-heading plan, a reflow that doesn't keep the place drops the reader somewhere else.
    - Whether WebKit already does this on its own is an open question (§7.1). The rule holds either way.
11. **The rest of the reader's behaviour stays as it is.**
    - The Contents gate (R28), its highlight rule, and clicking a heading to scroll there.
    - The 640 px threshold.
    - The page/reader divider (`reader_width_pct`, 20–80 %), and Expand.

### Part 2 · Tabs

**What makes a tab**

12. **Every file the reader shows has a tab.** Every route in makes a tab, or brings the file's tab forward if it
    already has one:
    - `kinas open`;
    - the sidebar's Pinned and Files rows, and a client folder's README;
    - Home's rows;
    - the reader's own tree;
    - a link followed inside a document, and the fragment it names is scrolled to;
    - ← and → (rule 30).
    One file is never in two tabs: a tab is keyed on the file's real path.
13. **A folder is not a tab** (answer 3A). Opening a folder works as today:
    - its files show in the sidebar's Files, or in the reader's own tree while the sidebar is hidden;
    - its README opens in a tab;
    - with no README, no tab is added and none is showing: the reader says "Choose a file" under the strip.
    The open folder stays one for the whole reader, as today. Switching to a tab from another folder does not
    change it, just as a click on a file outside the open folder does not change it today.
14. **Where a tab goes.** A new tab goes at the right end of the strip. A tab brought forward keeps its place. Only
    a drag (rule 19) changes the order.

**How many, and for how long**

15. **At most 15 tabs**, the size Recent has today (`RECENT_CAP`). Opening a 16th file closes the tab that was
    showing longest ago, and never the one showing. That tab is forgotten, as a file that fell off Recent is today;
    ← can still reach the file (rule 30), and reopening it makes a new tab at the right end.
16. **Tabs last until Kinas quits, and are never stored** (answer 2A).
    - The list lives in memory only. No path reaches the store or the log.
    - This is the reader's privacy rule, the one Recent keeps today: the one path Kinas stores is a pin, because a
      pin is an explicit click (ADR 0007). Storing the tabs would store every file merely opened.
    - After a relaunch the reader has no tabs. That was AC-13's promise about Recent, and it becomes the tabs'.

**Closing**

17. **A tab closes with its × or a middle-click.**
    - The × shows on the showing tab, and on any tab under the pointer.
    - Closing the showing tab shows the tab that was showing before it: the most recent one still open.
    - Closing the last tab closes the panel.
18. **The reader's × hides the panel and keeps its tabs** (answer 2A).
    - Opening any file brings the panel back with every tab, plus that file's.
    - ← brings it back too, because closing the panel is a place (rule 29).
    - This replaces today's ×, which forgets the document and the Back list.

**Reordering**

19. **Drag a tab along the strip to move it** (answer 5, the exception).
    - The other tabs make room as it passes, and the drop sets the order for the session.
    - A press that moves less than 4 px is a click, not a drag.
    - Dropping outside the strip cancels, and the order is unchanged. There are no tabs torn off into windows.
    - A drag never opens, closes or switches to a tab: the tab showing before the drag is showing after it.

**The strip**

20. **One row at the top of the reader, above its header.**
    - It is `--chrome-h` tall, the terminal chrome's height, on `--surface-2`, as the terminal's chrome is.
    - The showing tab is on `--surface` with `--ink`, joined to the header below it. The others are `--ink-2`.
    - When the tabs don't fit, the strip scrolls sideways, and the showing tab is always scrolled into view. The
      window never scrolls sideways (DESIGN.md §3).
21. **What a tab says.**
    - The sidebar's file icon, then the file's name, then its ×.
    - Two tabs with the same name each add their parent folder's name after a dot, e.g. "prd.md · first-mate" and
      "prd.md · reader-layout".
    - The tooltip is the display path, the same text `.reader-path` shows.
    - A tab is at most 200 px wide, and a long name ends in an ellipsis.

**Switching**

22. **A tab shows its file as it is now, where the captain left it.**
    - Switching reads the file again, so a file changed while its tab was in the background shows the change.
    - It opens at the scroll position the tab had when it was last showing, and in the view (Rendered or Source)
      the session has chosen for that kind of file, as today.
    - Only the showing tab is watched for live reload, as the one open file is today. Fifteen tabs cost nothing
      until they are shown.
23. **A switch is a click.**
    - A tab click, ← and → go through the same door as a click in the sidebar (`reader_allow_click`), so every path
      is checked again in Rust (ADR 0009).
    - None of them adds a line to the log that the 200 ms open gate counts. Only `kinas open` does.
    - A switch never moves keyboard focus (R34). If the terminal had focus, it keeps it.
24. **A tab whose file has gone stays until it is closed.** Switching to it shows the reader's problem message
    under the strip, as a pin to a missing file does today. The other tabs are untouched.

**Recent leaves the sidebar**

25. **The sidebar has no Recent section.**
    - The section goes, with its rows and their hover buttons (Open in the terminal, Pin).
    - Opening a folder in the terminal no longer adds it to anything.
    - Pinned, Files and the client folders are unchanged, and between them the pin and terminal buttons stay
      reachable for every folder that has them today: pins, the Files header, client folders.
    - A folder that used to live in Recent is kept at hand by pinning it (answer 3A).

### Part 3 · The top bar

**The bar**

26. **Kinas draws the window's title bar.**
    - It is one bar across the whole window, where the macOS title bar is today, `--chrome-h` tall, on `--bg`.
    - From the left: the traffic lights (the system's own), the sidebar button, ←, →. Nothing else: there is no
      title text, because each page names itself.
    - It is still a title bar. Dragging it moves the window, and double-clicking it zooms the window (§7.2: always
      zoom, whatever the Mac's own double-click setting says).
27. **The bar is always there:**
    - on every page, with the sidebar shown or hidden, and with the reader expanded;
    - in full screen, where the traffic lights are gone and the three buttons start at the bar's left padding.

**The sidebar button**

28. **The sidebar button is ⌘S by click.**
    - It hides or shows the sidebar exactly as the chord does, and the choice is remembered across launches the
      same way (`sidebar_visible`).
    - The tooltip names what a click will do, with the chord Settings has bound: "Hide the sidebar (⌘S)" or
      "Show the sidebar (⌘S)".

**← and →**

29. **← and → walk the places the captain has been, in order, like a browser** (answer 4A).
    - **A place** is the page that is showing plus what the reader shows: a file, a folder with no file, or
      nothing, because the panel is closed.
    - **A new place is recorded** when the page changes (⌘1, ⌘2, ⌘4, ⌘,, the sidebar, the palette, the gear, a
      Home row), or when the reader starts showing a different file, a folder with no file, or nothing. That
      covers any open, a tab click, closing the showing tab, and the reader's ×.
    - **None of these is a place:** a reload of the same file, a jump within one file (a Contents click, a `#`
      link), scrolling, Rendered/Source, Files/Contents, Expand, the sidebar button, and any drag.
30. **Going back.**
    - ← returns to the previous place: its page, and the reader showing what it showed, at the scroll position the
      file had when it was left.
    - A file whose tab has since closed, or been pushed out by rule 15, opens again as a new tab.
    - A file that has gone shows the reader's problem message (rule 24), and the place stays in the list.
    - → undoes a ←.
    - Recording a new place after going back drops every place ahead of it, as a browser does.
31. **The list's limits.**
    - It holds up to 50 places, which is today's Back limit (`BACK_CAP`). The oldest is dropped first.
    - It lives in memory and is forgotten on quit, like the tabs (rule 16).
    - At launch it is empty, and ← and → are disabled, drawn in `--ink-3`, with the reason in the tooltip.
    - A page reached by ← or → behaves as reaching it by its chord does. The Work page gives the terminal focus, as
      ⌘2 does; any other page moves no focus.
32. **The reader's own ← goes.** The header starts with the view toggle, or with the path for a file that has only
    one view. One Back for the whole app, because two Backs with different meanings side by side would be tripped
    over.

### For all three parts

33. **The terminal is never remounted** (ADR 0002).
    - The title bar and the tab strip are static parts of the tree, and nothing above `<Terminal>` becomes
      conditional, wrapped, re-keyed or re-parented.
    - `ptyPid` is unchanged across every gesture in this spec.
34. **Click-only** (answers 1A and 5A). This adds no key binding: none for tabs, none for ← and →, none for the
    column. ⌘S and ⌘W keep their meanings. `keymap.md` is the gate, and a key is added when one is missed.

## 3. Flows

**Hiding and showing the column (wide)**
1. The captain clicks the pressed Contents button.
2. The section goes and the button is released. With Files not showing either, the whole column goes.
3. The text reflows to the new width, and the top line stays at the top (rule 10).
4. "Contents hidden" is saved.
   - If the save fails, nothing is said, and the session keeps the choice (rule 4).
5. Clicking again brings the section back at the stored width, and "shown" is saved.

**Resizing the column**
1. Pointer down on the edge: the drag starts. Text selection is off, and the resize cursor holds even over the
   text.
2. Pointer move: the column follows, kept between 160 and the smaller of 480 and the reader's width less 320
   (rules 5, 6). The text reflows as it goes, and the top line stays at the top.
3. Pointer up: the width is saved, in one write.
   - Pointer cancel ends the drag the same way, at the width it reached.
4. A double-click sets 220 and saves it.

**Opening a file**
1. The file arrives by any route in rule 12.
2. It already has a tab: that tab comes forward, keeping its place, and the file is read again.
3. It has no tab:
   - with 15 tabs open, the one showing longest ago closes first (rule 15);
   - a new tab is added at the right end, and the file is read.
4. The panel shows, if it was hidden.
5. A new place is recorded (rule 29).
6. Reading fails: the tab stays and shows the problem (rule 24).

**Switching tabs**
1. The captain clicks a tab.
2. The tab showing records its scroll position.
3. The clicked tab's file is read through the click door (rule 23) and shown where it was left (rule 22).
4. A new place is recorded.

**Closing**
- A tab's × or a middle-click: the tab goes.
  - If it was showing, the most recent tab still open shows (rule 17), and that is a new place.
  - If it was the last tab, the panel closes, and that is a new place.
- The header's ×: the panel hides and the tabs stay (rule 18), and that is a new place.

**Dragging a tab**
1. Press, then move 4 px or more: the drag starts.
2. The tab follows the pointer, and the others make room.
3. Release over the strip: the order is set. Release anywhere else: the order is unchanged. Nothing opens, closes
   or switches.

**← and →**
1. The captain clicks ←.
2. The current place records the showing file's scroll position.
3. The previous place's page shows, as its chord would show it.
4. The reader shows that place's file (its tab brought forward, or opened again as a new tab), its folder, or
   nothing (the panel hides).
5. → is enabled.
   - A new place recorded now drops every place ahead of it.

**The sidebar button**
- Same as ⌘S: the sidebar hides or shows, the choice is saved, and the text reflows with its place kept
  (rule 10).

**Launch**
1. `get_ui_prefs` returns the column's three values with the divider's width and the sidebar's visibility, before
   the window draws. A missing or bad value is its default (rule 4).
2. There are no tabs, and nowhere to go back or forward to.

## 4. Surfaces

**The window's title bar** (rules 26–28, 31)
- It replaces the standard macOS title bar: the traffic lights, the sidebar button, ← and →.

**The sidebar** (rule 25)
- It loses Recent. Nothing else in it changes.

**The reader**
- **Tab strip** (rules 12–24), above the header.
- **Header:**
  - ← goes (rule 32);
  - Files and Contents show at every width (rules 1–3);
  - × now hides the panel and keeps the tabs (rule 18).
- **Side column:**
  - the edge becomes a resize grip (rule 5);
  - its width comes from the remembered value (rules 4, 6, 7);
  - each Contents row gets a tooltip (rule 8).
- **Document:** no width cap (rule 9), and the place is kept on every reflow (rule 10).

**Components.** DESIGN.md §4 is the law, and a component is written there before its code.
- **Tab strip (new).** The strip and its tab in their states: showing, not showing, pointed at (with its ×), and
  being dragged. It is named "Tab strip" so it is never confused with the phone's "Tab bar" in §4.
- **Title bar (new).** The window's bar and its three buttons, enabled and disabled.
- **Reader header (as built).** Amended as above.
- **Two new icons** in `icons.tsx` on the 16 grid: the sidebar (a panel with its left column) and forward (Back's
  mirror).
- Each new component gets a story in the catalogue, because `stories.test.ts` holds the catalogue equal to
  DESIGN.md.
- The column's edge takes the look of the page/reader divider, which is shell CSS. Gate 3 decides whether the two
  become one component.

**Docs, written before the code:**
- `DESIGN.md`, in a dated 1.4 entry:
  - §3.1's sidebar sentence drops Recent;
  - §3.1 gains the title bar;
  - §4 gains the Tab strip and the Title bar, and amends the Reader header note;
  - the Reader note gains the column and the text rules.
- `keymap.md`: a dated amendment.
  - The reader's click-only paragraph names Files, Contents, the column's edge, the tabs (click, ×, middle-click,
    drag) and the header's ×.
  - A new paragraph says ←, → and the sidebar button are click-only. ⌘S is unchanged, and the button is its click.
- `README.md` and `docs/smoke-test.md`: the sidebar without Recent, and a hand check of the title bar's drag and
  double-click, which WebDriver cannot drive.
- The reader PRD (private, on the captain's Mac) gets a dated amendment to §4's "220 px" and "at most 72ch" lines,
  and to the Back rules, pointing here.

**Screens**
- `mockups/window.html` — the whole window: the title bar, the sidebar without Recent, a page, and the reader with
  its tabs. Two states: sidebar shown, and sidebar hidden with ← enabled and → disabled.
- `mockups/reader.html` — the reader in six states:
  1. Contents showing, the edge pointed at.
  2. Contents hidden, the text filling.
  3. Expanded on a wide screen, the column dragged wider.
  4. Files and Contents together, with the sidebar hidden and a folder open.
  5. Fifteen tabs, the strip scrolled, one tab being dragged, another under the pointer with its ×.
  6. Two files of the same name.

## 5. Validation

**Pure tests (Bun)**

*The column*
- The width the column is **drawn** at, from the stored width and the reader's width:
  - 220 in a 1000 px reader → 220;
  - 300 in a 1400 px reader → 300;
  - 480 in a 700 px reader → 380;
  - 480 in a 640 px reader → 320.
- The width a **drag** asks for, from the pointer's distance to the column's left edge and the reader's width:
  - 100 → 160;
  - 600 in a 1400 px reader → 480;
  - 400 in a 700 px reader → 380;
  - 250 → 250.
- Whether a button shows, and whether it is pressed, for each of these cases:
  - wide or narrow;
  - section offered or not;
  - remembered shown or hidden;
  - overlay open or not.

*Tabs*
- Opening a new file appends it; opening one that is already open changes nothing but which tab shows.
- The 16th file closes the tab showing longest ago, never the showing one, and is appended.
- Closing the showing tab shows the most recent tab still open; closing the last leaves none.
- Reordering moves one tab and keeps every other in its relative order; a cancelled drag changes nothing.
- Labels: two `prd.md` in different folders read "prd.md · first-mate" and "prd.md · reader-layout"; a single one
  reads "prd.md".

*History*
- Recording, ←, → and the rule that recording after ← drops the places ahead.
- The 51st place drops the first.
- A reload, a `#` jump or a view toggle records nothing.
- ← to a file with no tab reopens it: the tabs gain it at the right end.

**Rust unit tests**
- The column's three values read as their defaults when missing, and for bad values: `"x"`, `null`, `NaN`, 90,
  900, and a number where a boolean belongs.
- Each setter refuses an out-of-range width, as `set_reader_width` refuses a share outside 20–80 %.

**New e2e specs, each run alone**

*`reader-layout.e2e.ts` (Part 1).* The reader is expanded, so it is wider than 640 px on the e2e window. It opens
the plan fixture, which is tall and has at least two headings.
1. The Contents button is present and pressed. `.reader-contents` is in a `.reader-side` with no `data-overlay`.
2. Click Contents:
   - `.reader-side` is gone and the button is released;
   - `.reader-doc` is as wide as the scroller less its two 28 px paddings;
   - the stored "Contents shows" value is false.
3. Open another markdown file: Contents is still hidden.
4. Click Contents, then drag the edge 100 px right:
   - `.reader-side` is 320 px wide, and so is the stored width;
   - a double-click on the edge sets both back to 220.
5. Drag the edge far left: 160. Drag it far right: the smaller of 480 and the reader's width less 320.
6. Click the 40th heading in Contents, then hide Contents. That heading's top is within 24 px of the scroller's
   top, and it is still the highlighted row. Do the same across Collapse and Expand, and across the sidebar
   button.
7. Collapse the reader to its default share, which is narrower than 640 px:
   - Contents opens over the text, as `reader.e2e.ts:98–103` already checks;
   - the stored "Contents shows" value does not change.

*`reader-tabs.e2e.ts` (Part 2).*
1. `kinas open` three files: three tabs, in that order, the third showing.
2. Scroll the first file to its 20th heading, switch to the second, then back to the first: the 20th heading is
   within 24 px of the top.
3. Follow a link from the second file to a fourth: a fourth tab, showing.
4. `kinas open` the first file again: still four tabs, and the first is showing, in its place.
5. Open sixteen fixture files: fifteen tabs, and the one showing longest ago is gone.
6. Close tabs:
   - a tab's × closes it;
   - a middle-click closes another;
   - closing the showing tab shows the one that showed before it.
7. Drag the last tab to the first place: the order changes and the showing tab does not. A drag released below
   the strip changes nothing.
8. The header's ×: the panel hides. Click a pin: the panel is back with every tab, plus the pin's.
9. `.sidebar-recent` does not exist at any point.
10. Switching tabs adds no `reader: rendered` line.
11. Switching tabs never takes the terminal's focus.

*`title-bar.e2e.ts` (Part 3).*
1. At launch, ← and → are disabled.
2. Click the sidebar button: the sidebar hides and `sidebar_visible` is false. Click it again: back, and true.
3. Walk Home → Usage → open file A → open file B → Settings, then click ← four times. The places are, in order:
   (Usage, B), (Usage, A), (Usage, nothing), (Home, nothing).
4. → twice: (Usage, A).
5. Open file C: → is disabled.
6. Close A's tab, click ← until the place is (Usage, A): A is open again, as a tab at the right end.
7. ← onto the Work page gives the terminal focus.

*Every one of the three specs:* `ptyPid` is the same at the end as at the start.

**Existing assertions that change, all of them**
- `reader-pins-a.e2e.ts` and `reader-pins-b.e2e.ts` (AC-12, AC-13). The pins stay as they are. Recent's
  assertions become the tabs':
  - the first launch opens files and sees them as tabs;
  - the second launch sees no tabs and no `.sidebar-recent`.
- `reader-terminal.e2e.ts`:
  - "an opened folder joins Recent as a folder…" is deleted, because the thing it tests is gone. It is replaced by
    "an opened folder puts its README in a tab, and adds no tab of its own".
  - The Open-in-the-terminal cases that click a Recent row move to the same button on the folder's pin.
- `reader.e2e.ts:193` clicks the reader's Back. It clicks the title bar's ← instead, and expects the same document
  at the same scroll position.
- Every other case in `reader.e2e.ts` and `reader-panel.e2e.ts` passes unchanged. Those cases run narrow, or with
  the sidebar showing, where the header buttons do not change.
- A `fixtures/screens` style contract that pins the reader's 72ch, or the sidebar's Recent, is updated and named in
  the commit. `docs/design/screens/*.png` are re-taken, because every page shows the title bar and the sidebar.
- Nothing is skipped or loosened.

**The whole of it**
- `bun run check` green.
- The full e2e suite green, alone.
- The private-names check over every added line, commit message and file name returns 0.
- By eye, in both themes, on a wide screen:
  - the column's edge;
  - the tab strip with fifteen tabs;
  - a drag;
  - the title bar in a window and in full screen;
  - the title bar dragged to move the window, and double-clicked to zoom it (smoke test).

## 6. Out of scope

- **Key bindings** for tabs, for ← and →, or for the column (answer 5A). `keymap.md` is the gate, and ⌘W still
  hides the window.
- **Anything below 640 px** in Part 1: the overlay, its 220 px width, the threshold itself.
- **Contents for source, preview and image files.** It stays markdown only (R28).
- **Font size, line height, or a "readable width" option.** The fallback, if long lines turn out tiring, is round
  1's option 4C: a Fit / Readable choice in the ▾ menu.
- **Tabs that survive a relaunch** (answer 2A). They would store every file merely opened.
- **Split view**, **pinning a tab** (Pinned stays in the sidebar), **reopening a closed tab**, and **tearing a tab
  off** into its own window (answer 5A).
- **Folder tabs** (answer 3A).
- **Per-kind tab icons** (markdown, image, code). A tab has the sidebar's file icon (§7.3, answered).
- **A title in the title bar**, or anything in it beyond the three buttons.
- **The page/reader divider and Expand** themselves.

## 7. Open questions

1. **Does WebKit's scroll anchoring keep the place on its own?**
   - If Kinas's webview anchors the scroll natively, rule 10 costs nothing. If not, the reader does it.
   - **Decided by** measurement in Part 1's first slice, on the debug build. It is not the captain's call.
2. **The drawn title bar, on the Mac.**
   - ~~Does a double-click follow the Mac's own "double-click a window's title bar to" setting?~~ **Answered at
     Gate 2 (2026-09-23), from the pinned Tauri 2.11.5 source:** no. Its drag script sends a double-click to
     `internal_toggle_maximize`, which zooms and never reads that setting. So the drawn bar always zooms, which is
     this question's stated fallback, and the smoke test says so.
   - Where do the traffic lights sit, and where do the buttons go in full screen? **Measured** on the debug build
     in the title bar's slice.
3. ~~**One file icon, or one per kind?**~~ **Answered 2026-09-23, at Gate 1's approval:** one file icon for every
   tab, the sidebar's.
4. ~~**The 160, 480 and 320 px limits, 15 tabs, and 200 px per tab.**~~ **Answered 2026-09-23, at Gate 1's
   approval:** kept as written.
5. **One component for the two dividers?** The page/reader divider and the column's edge would look and behave
   alike. **Gate 3** decides whether they share code.

**Asked and answered, round 1 (2026-09-23)**

1. How do you close Contents and get it back? — **A.** The existing header button at every width, pressed while
   showing. Below 640 px it still opens over the text.
2. What does Kinas remember? — **A.** Both whether it is hidden and its width, across files and relaunches, saved
   like the divider's width and ⌘S.
3. How do you resize it? — **A.** Drag the line between the column and the text, 160–480 px, and double-click for
   220. No snapping closed.
4. How wide should the text go? — **A.** No cap: prose fills the width. The Fit / Readable menu choice (4C) is the
   fallback.
5. Scope: Files shares the column. — **A.** Files gets the same treatment through its own button, and the two
   share one width. Kept out: a key binding, Contents for non-markdown files, font size and line spacing, and
   anything below 640 px.

**Asked and answered, round 2 (2026-09-23)**

1. What opens a tab? — **A.** Every file opened, links included. A file already open brings its tab forward, so the
   tabs are exactly the recent files.
2. How many, and how long? — **A.** At most 15, the one showing longest ago closing first. They last until Kinas
   quits, and are never stored. The reader's × hides the panel and keeps them.
3. Recent's folders? — **A.** Tabs are files only. Opening a folder works as today, and a folder is kept at hand by
   pinning it.
4. What do ← and → walk? — **A.** Every place, pages and files alike, and the reader's own ← goes.
5. Scope. — **A, except dragging tabs to reorder, which comes in.** Kept out: keys for tabs or ← and →, split view,
   pinning a tab, and reopening a closed tab.
6. Defaults stated with round 2 and not contradicted:
   - the bar sits right of the traffic lights and stays when the sidebar hides;
   - it drags and double-clicks like a title bar;
   - the sidebar button is ⌘S's click;
   - new tabs open at the right end, and each keeps its scroll position;
   - Part 1 is built first.
