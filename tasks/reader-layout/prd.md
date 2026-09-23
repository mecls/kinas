# The reader's layout — Implementation Spec

*2026-09-23. Written from the captain's request, which came with two screenshots: the reader at about 875 px with
Contents in its fixed 220 px column, and the reader expanded on a wide screen with the text stopping at 72ch. Also
from the answers 1A, 2A, 3A, 4A, 5A (§7). On `docs/reader-layout-gate-1` from `origin/main` at `1394be7`.*

## 1. Objective

The reader's side column holds Contents, and also Files when the sidebar is hidden. Today it is always 220 px, and
while the reader is 640 px wide or more it cannot be put away. The text beside it stops at 72ch, about 95
characters of prose. So on a big screen, even with the reader expanded, a third of it is empty.

This change lets the captain:

- **hide and show Contents and Files** from the header's two buttons, at every width;
- **drag the column's edge** to make it narrower or wider;
- **read prose across the whole width** the reader has.

Kinas remembers the first two choices across files and relaunches. Below 640 px nothing changes: there the column
already lives behind the same two buttons.

Why now: the captain reads the PRDs and build specs of every feature in the reader, on a wide screen, every day.
The screenshots show the first mate's PRD. The fixed column and the 72ch measure waste most of the room that Expand
exists to give.

## Announcement

The reader now gets out of your way. The Contents and Files buttons in its header work at every size: click one
to put that list away, click it again to bring it back, and Kinas remembers the choice for the next file and the
next launch. Drag the line between the list and the text to make the column narrower or wider; double-click it to
go back to where it started. And the text fills the reader: expand it on a big screen and paragraphs use the whole
width instead of stopping in the middle. Through all of it you stay at the same place in the document.

## 2. Business rules (invariants — never violate)

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
   - **One set for the whole reader**, never per file or per folder (answer 2A). If you hide Contents, you don't
     want it on the next file either.
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
      - resizing the window.
    - Why this is needed now: with the 72ch cap, widening the reader rarely reflowed the text, because it was
      already at the cap. Now that prose fills the width, every one of those gestures reflows it. In a
      300-heading plan, a reflow that doesn't keep the place drops the reader somewhere else.
    - Whether WebKit already does this on its own is an open question (§7.1). The rule holds either way.

**What does not change**

11. **Everything else about the reader stays as it is.**
    - The Contents gate (R28), its highlight rule, and clicking a heading to scroll there.
    - The 640 px threshold.
    - The page/reader divider (`reader_width_pct`, 20–80 %), and Expand.
    - The reader adds no key binding (answer 1A, `keymap.md`).
    - The terminal is never remounted (ADR 0002): nothing here sits above `<Terminal>`, and `ptyPid` is unchanged
      across every gesture in this spec.

## 3. Flows

**Hiding and showing, wide**
1. The captain clicks the pressed Contents button.
2. The section goes and the button is released. With Files not showing either, the whole column goes.
3. The text reflows to the new width, and the top line stays at the top (rule 10).
4. "Contents hidden" is saved.
   - If the save fails, nothing is said, and the session keeps the choice (rule 4).
5. Clicking again brings the section back at the stored width, and "shown" is saved.

**Resizing**
1. Pointer down on the edge: the drag starts. Text selection is off, and the resize cursor holds even over the text.
2. Pointer move: the column follows, kept between 160 and the smaller of 480 and the reader's width less 320
   (rules 5, 6). The text reflows as it goes, and the top line stays at the top.
3. Pointer up: the width is saved, in one write.
   - Pointer cancel ends the drag the same way, at the width it reached.
4. A double-click sets 220 and saves it.

**Launch**
1. `get_ui_prefs` returns the three values with the divider's width, before the window draws.
2. A missing or bad value is its default (rule 4).
3. The first file opens with the column as it was left.

**Narrow**
- Unchanged: a button opens its section over the text and closes it again, exactly as today. Nothing is saved.

## 4. Surfaces

**The reader's header.** Files and Contents at every width (rules 1–3). Nothing else in the header changes.

**The reader's side column.**
- The right edge becomes a resize grip (rule 5).
- The width comes from the remembered value, limited by the reader's width (rules 4, 6, 7).
- Each Contents row gets a tooltip (rule 8).

**The document.** No cap on width (rule 9), and the place is kept on every reflow (rule 10).

**Components.** The reader header is the one DESIGN.md §4 names ("Reader header", as built, the reader's own). The
column's edge takes the look of the page/reader divider, which is shell CSS, not a library component. Gate 3
decides whether the two become one component. No new library component is proposed here.

**Docs, written before the code:**
- `DESIGN.md`: a dated 1.4 entry. The reader's note gains three things: Files and Contents at every width, the
  column hidden and resized by its edge, and prose filling the reader.
- `keymap.md`: the reader's click-only paragraph names Files, Contents and the column's edge, dated. No key.
- The reader PRD (private, on the captain's Mac) gets a dated amendment to §4's "220 px" and "at most 72ch" lines,
  pointing here.

**Screens**
- `mockups/reader.html` — one screen in four states:
  1. Contents showing, the edge pointed at.
  2. Contents hidden, the text filling.
  3. Expanded on a wide screen, the column dragged wider.
  4. Files and Contents together, with the sidebar hidden and a folder open.

## 5. Validation

**Pure tests (Bun):**
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

**Rust unit tests:**
- The three values read as their defaults when missing, and for bad values: `"x"`, `null`, `NaN`, 90, 900, and a
  number where a boolean belongs.
- Each setter refuses an out-of-range width, as `set_reader_width` refuses a share outside 20–80 %.

**A new e2e spec, `reader-layout.e2e.ts`, run alone.**
- The reader is expanded, so it is wider than 640 px on the e2e window. It opens the plan fixture, which is tall
  and has at least two headings.

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
   top, and it is still the highlighted row. Do the same across Collapse and Expand.
7. Collapse the reader to its default share, which is narrower than 640 px:
   - Contents opens over the text, as `reader.e2e.ts:98–103` already checks;
   - the stored "Contents shows" value does not change.
8. `ptyPid` is the same at the end as at the start.

**Existing assertions:**
- `reader.e2e.ts` and `reader-panel.e2e.ts` read the Contents and Files buttons.
  - Every case there runs narrow, or with the sidebar showing, where nothing changes. So they must pass
    **unchanged**.
  - If one needs an edit, it is named in the commit with the reason. Nothing is skipped or loosened.
- A `fixtures/screens` style contract that pins the reader's 72ch is updated, and named in the commit.

**The whole of it:**
- `bun run check` green.
- The full e2e suite green, alone.
- The private-names check over every added line, commit message and file name returns 0.
- By eye, in both themes, on a wide screen:
  - the edge's accent line;
  - the pressed and released buttons;
  - an expanded reader with Contents hidden, the text running edge to edge inside its padding.

## 6. Out of scope

- **A key binding or palette command** for any of this (answer 1A). The reader stays click-only until a key is
  missed; `keymap.md` is the gate.
- **Anything below 640 px:** the overlay, its 220 px width, the threshold itself (answer 5A).
- **Contents for source, preview and image files.** It stays markdown only (R28, answer 5A).
- **Font size, line height, or a "readable width" option** (answer 4A chose fill). The fallback, if long lines turn
  out tiring, is option 4C: a Fit / Readable choice in the ▾ menu.
- **Remembering per file or per folder** (answer 2A).
- **Dragging the column small to close it** (answer 3A). The button is the one way to close.
- **Moving Contents** to the other side of the text, or into the left sidebar.
- **The page/reader divider and Expand** themselves.

## 7. Open questions

1. **Does WebKit's scroll anchoring keep the place on its own?**
   - If Kinas's webview anchors the scroll natively, rule 10 costs nothing. If not, the reader does it.
   - **Decided by** measurement in the first slice, on the debug build. It is not the captain's call.
2. **The 160, 480 and 320 px limits are my numbers, not the captain's.** Confirm them by eye in the mockup and on
   the first build.
3. **One component for the two dividers?** The page/reader divider and the column's edge would look and behave
   alike. **Gate 3** decides whether they share code.

**Asked and answered, 2026-09-23**

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
