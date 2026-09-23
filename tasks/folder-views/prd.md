# Sidebar folder views — Implementation Spec

*2026-09-23. Written from Miguel's request and his answers (1A, 2B, 3B, 4A, 5A). Built on `feat/folder-views` from
`main` at `ef13b12` (the design-system build, PR #24, merged 2026-09-23).*

## 1. Objective

Right now the sidebar lists every git repository under the projects folder, and Kinas has no way to change which
ones. The folders Miguel no longer works on sit in the sidebar, on Home and in Settings forever. This change
lets him:

- **Hide** a client folder from the sidebar and Home, and show it again.
- **Add** one the discovery walk does not find, such as a new client's folder with no git yet.
- **Remove** a folder from Kinas altogether. Removing never touches the disk, and the folder can be restored.

Hiding and adding work from a right-click on the sidebar's client folders. All three work from Settings → Client
folders.

Three layout fixes to the same sidebar ride along:
- The Reader row goes. It adds nothing: clicking a file already opens the reader, and with no file it has
  nothing to show.
- Settings moves to the bottom of the sidebar.
- Recent moves below the client folders.

## 2. Business rules (invariants — never violate)

**The sidebar's shape**

1. **The navigation is five rows:** Home, Work, Crew, Inbox, Usage, in that order, in `.sidebar-nav`.
   - The Reader row (`Sidebar.tsx:116`) is deleted, and so is everything that only served it:
     - `onReader` and `readerOpen` (the Sidebar props).
     - `reopenReader` (`App.tsx`).
     - The notice "Nothing to reopen — kinas open <file>".
   - The reader panel still opens exactly as it does today: a click on a file or folder anywhere in the sidebar,
     a row on Home, or `kinas open`. Closed with ×, it stays closed until one of those happens.
2. **Settings is the sidebar's last element.** It comes below the shell's notice and the VPS line (`<Machine />`),
   pinned to the bottom of the column, and it never scrolls with the sections above.
   - It keeps its `NavItem`, `aria-label="Settings"`, the chord in its title and `aria-current` on the Settings
     page.
   - Two e2e specs click it by `.sidebar button[aria-label="Settings"]` (`settings.e2e.ts:86`) and
     `.shell nav button[aria-label="Settings"]` (`reader-panel.e2e.ts:193`). Both must keep working unchanged.
3. **The scrolling sections run in this order:**
   1. Pinned
   2. the open folder's Files
   3. Client folders
   4. Recent

   "A section with no rows is not rendered at all" (Miguel's rule, `Sidebar.tsx` header comment) still holds for
   every one of them.

**A folder's three states**

4. **Every client folder is in exactly one state:**

   | State | Sidebar | Home (Overnight) | Settings |
   |---|---|---|---|
   | Shown | yes | yes | main list, "In sidebar" switch on |
   | Hidden | no | no | main list, "In sidebar" switch off |
   | Removed | no | no | only in the "Removed" list, with Restore |

   Hidden and Removed differ in one place only: whether Settings' main list still shows the folder.
   That is the whole meaning of "hide from view" versus "remove from the app" (answers 1A and 2B).
5. **Removing a folder never touches anything but Kinas's own lists.** It never:
   - deletes, moves or renames anything on disk;
   - unpins the folder (a pin is its own explicit choice, `reader/pins.rs`);
   - drops it from Recent, or from what `kinas open` can open (it is still inside the projects folder);
   - touches its Herdr workspace;
   - touches the first mate's context packet (answer 5A: `packages/context/src/sources/projects.ts` still walks
     and reads every repository).
6. **Restore brings a folder back shown.** Restore clears the path from both the removed and the hidden lists.
   A folder that came back hidden would look like Restore did nothing.
7. **The category and internal choices survive hide, remove and restore.** Those rows stay keyed by name, as today
   (`folder_categories`, `folder_internal`), and are never pruned. A restored folder wears the colour it had.

**Colours stay put**

8. **Colours are seated over every listed folder, hidden and removed ones included, and the surfaces filter
   afterwards.**
   - `seatFolders` (`shell/folders.ts`) seats colours in name order over the whole listing, so the colour a name
     derives depends on which other names are in the list.
   - If the sidebar dropped hidden folders *before* seating, hiding `acme` would repaint every folder after it.
   - So `list_projects` returns hidden and removed folders too, flagged, and each surface filters the seated list.
     Hiding or removing one folder must not change any other folder's `data-cat`.

**Adding a folder (answer 3B)**

9. **An added folder must be inside the projects folder, and must not be the projects folder itself.**
   - Rust checks this on the canonical path, with `reader::access::resolve` then `access::inside(real, real_root)`,
     the same test every reader path passes (ADR 0009).
   - A folder outside the root is refused. Allowing it would mean re-asking permission after every relaunch, as
     pinned folders outside the root already have to.
   - The added folder need not be a git repository and may sit at any depth.
   - Refusals are in Rust's words:
     - *"Choose a folder inside the projects folder (~/…)"*
     - *"That is the projects folder itself — choose a folder inside it"*
     - *"Choose a folder"* (the pick is not a directory)
10. **Adding a folder that is already listed changes its state instead of listing it twice.**

    | The folder was | Result | Notice |
    |---|---|---|
    | Removed | restored and shown | "Restored <name>" |
    | Hidden | shown | "<name> is back in the sidebar" |
    | Already shown | nothing changes | "<name> is already in the sidebar" |
    | Not listed | appended to `folder_added` | "Added <name>" |

    Cancel in the Finder window says nothing and changes nothing.
11. **An added folder is listed only while it exists and is still inside the current projects root.**
    - One that is gone from disk, or left outside the root because the root changed, is not listed anywhere.
    - Its stored path is kept, not pruned: an unmounted volume must not lose Miguel's list.
    - It is named like any discovered folder: added and discovered paths go through `names_for` together, so two
      folders both called `site` still show as `one/site` and `two/site`.
12. **The Finder window is Rust's and opens once at a time.**
    - It uses `tauri_plugin_dialog` from Rust, as `reader/export.rs::choose_destination` does: the webview gets no
      dialog permission and `capabilities/` stays byte-identical.
    - Title "Add a client folder". It opens in the projects folder and can create a folder, since a new client's
      folder may not exist yet.
    - While one is open, a second request is refused: "The folder window is already open".
    - In debug builds only, the environment variable `KINAS_E2E_PICK_FOLDER` names the pick instead, as
      `KINAS_E2E_EXPORT_TO` does, because no agent can click a native sheet. Every rule in 9–11 still runs on it.

**Where the choices are stored**

13. **Three new settings rows, each a sorted JSON array of canonical absolute paths:**
    - `folder_hidden`
    - `folder_removed`
    - `folder_added`

    They are read with the same forgiving rule as `stored_internal`: junk is ignored, never an error. No migration
    is needed.
    They are keyed by **path**, unlike categories, because `names_for` renames a folder when a second one with the
    same base name appears (`site` becomes `one/site`). A removal keyed on the old name would silently undo itself.
14. **Rust rechecks every path it is asked to hide, show, remove or restore.**
    - The path must be a row of the current listing (discovered, or an added folder that exists). Anything else is
      refused with "Not a client folder".
    - The webview never writes a path Rust did not list.
15. **Discovery stays cached; the choices do not.**
    - `ProjectsCache` still caches only the walk, for 60 s.
    - The three new rows, and whether each added folder exists, are read on every `list_projects`.
    - A hide or an add therefore shows on the very next listing. The webview asks for one after every change, as
      Settings does today through `onProjectsChange`.

**The right-click menu (answer 4A)**

16. **Right-clicking a client-folder row opens Kinas's own menu at the pointer**, kept inside the window.
    - The event is `contextmenu`, which also covers a two-finger tap and Ctrl-click. The handler calls
      `preventDefault` so WebKit's own menu never appears there.
    - The items:
      1. **Hide from sidebar**
      2. **Add a client folder…**
      3. When any folder is hidden: a divider, then **Show <name>** for each hidden folder, in name order.
    - Right-clicking the "Client folders" heading opens the same menu without "Hide from sidebar".
    - Removal is not in this menu. It lives in Settings, where the Removed list and Restore are in view.
17. **The menu is the reader's ▾ menu, moved into the library.**
    - `reader/Menu.tsx` and `reader/menuKeys.ts` move to `ui/`, with the same focus and key handling. It takes
      focus when it opens and gives it back when it closes, so nothing typed at an open menu reaches the terminal.
    - It merges `className` like `Card` and `Toast`. The reader passes `className="reader-menu"`, so the three
      reader specs that find it by `.reader-menu` (`reader-panel`, `reader-export`, `reader-pins-a`) stay
      byte-identical.
    - It gains one thing: a divider item (`role="separator"`) that the arrow keys skip.
    - Its styles move from `reader.css` (`.reader-menu*`) to the library as `.ui-menu*`, tokens only.
    - The `print.css` rule hiding the menu follows the rename.
18. **With every folder hidden or removed, the sidebar's Client folders section is not rendered** (rule 3), so there
    is nothing to right-click. Settings is the way back, and Home's empty state says so (rule 21).

**Settings → Client folders**

19. **The main list shows every folder that is not removed, in the listing's order.**
    - A hide never moves a row, as a switch never does today (`ClientFolderRows`).
    - Each row holds:
      - the chip (cycles the category, as today)
      - the name
      - an **In sidebar** switch (`aria-label="<name> is in the sidebar"`)
      - the existing **Internal** switch (`aria-label="<name> is internal"`, unchanged)
      - a **Remove** button (`aria-label="Remove <name> from Kinas"`)
    - The two switch columns carry visible headings, "In sidebar" and "Internal": two unlabelled switches in one
      row cannot be told apart.
    - An **Add a folder…** button under the list runs the same command as the menu item.
20. **A Removed list appears under the main list only when at least one folder is removed.**
    - Heading "Removed", one row per folder, each with its name and a **Restore** button
      (`aria-label="Restore <name>"`).
    - Remove asks for no confirmation: it is undone one row below.
    - The card's note line says "Removed <name>. Restore it below."
    - The card's help text is rewritten: *"Every git repository up to three levels under the projects folder, and
      the folders you added. The chip is the folder's colour on every page; click it for the next of the six. A
      folder out of the sidebar is off Home too. An internal folder is listed last, with the tag. Remove takes a
      folder out of Kinas without touching it on disk."*

**Home**

21. **Home's Overnight lists only shown folders.** It uses the same filter as the sidebar.
    - When the listing has folders but none are shown, the empty state reads *"Every client folder is hidden.
      Settings → Client folders shows them again."*
    - The existing *"No client folders under the projects folder yet."* stays for an empty listing.

## 3. Flows

**Hide from the sidebar (right-click)**

1. Right-click a client-folder row. The menu opens with "Hide from sidebar" first.
2. Choose it. The webview calls `setFolderHidden(path, true)`.
3. Rust checks the path against the listing (rule 14), adds it to `folder_hidden` and answers.
4. The webview reloads the listing (`loadProjects`). The row leaves the sidebar and Home, and the others keep their
   colours (rule 8).
5. The sidebar notice says "Hid <name> from the sidebar". It shows at the sidebar's foot only while the panel is
   closed, as every shell notice does today.
6. **If Rust refuses** (the folder vanished between listing and click): the notice gives Rust's words, and the
   listing reloads anyway so the stale row disappears.

**Show a hidden folder:** the same flow through "Show <name>" or Settings' switch, with `hidden = false`.
Notice: "<name> is back in the sidebar".

**Add a client folder** (menu item or Settings button)

1. The webview calls `addClientFolder()`.
2. Rust refuses at once if a folder window is already open (rule 12).
3. It opens the Finder window in the projects folder, on a worker thread as `choose_destination` does. It does not
   use `off_main`: a person choosing takes longer than a second, and that is not slow file work to warn about in
   the log.
4. **Cancel:** Rust answers `{ outcome: "cancelled" }`. Nothing more happens.
5. **A pick:** `resolve` → must be a directory → `inside(real, real_root)` and not equal to the root. Each failure
   is a refusal (rule 9), said at the sidebar foot or on Settings' note line, wherever the request came from.
6. **Accepted:** rule 10 decides the outcome. Rust writes the row(s) and answers
   `{ outcome: "added" | "shown" | "restored" | "already", name }`.
7. The webview reloads the listing and says the outcome's line.
8. **Log:** one line, `projects: client folder <outcome> in N ms`, and never the path or the name
   (ADR 0007: no paths in the log).

**Remove and restore (Settings only)**

1. Remove calls `setFolderRemoved(path, true)`. Rust adds the path to `folder_removed` and leaves `folder_hidden` as
   it is.
2. The row moves from the main list to Removed, and the note line says so.
3. Restore calls `setFolderRemoved(path, false)`. Rust drops the path from **both** `folder_removed` and
   `folder_hidden` (rule 6).
4. Failures go to the card's note line in Rust's words, through the existing `act("folders", …)`.

## 4. Surfaces

**Rust (`app/src-tauri/src/projects.rs`)**
- `ProjectRow` gains `hidden: bool` and `removed: bool`.
- `rows()` takes the stored paths and the added paths.
- New helpers:
  - `stored_paths(value)`, forgiving like `stored_internal`.
  - `listing(root, repos, added)`: discovered ∪ existing added paths inside the root, deduplicated, sorted, then
    named by `names_for`.
- New commands:
  - `set_folder_hidden(path, hidden)`
  - `set_folder_removed(path, removed)`
  - `add_client_folder()` (async, opens the dialog)

  All three are registered in `lib.rs`; `capabilities/` is untouched and no crate is added.
- Unit tests beside the existing ones in the file's `mod tests`.

**Webview**
- `api.ts`:
  - `ProjectRow.hidden` and `ProjectRow.removed`
  - `setFolderHidden`, `setFolderRemoved`, `addClientFolder`
- `shell/folders.ts`: `seatFolders` unchanged in what it seats, plus two filters:
  - `shownFolders(seated)`: not hidden and not removed.
  - `removedFolders(seated)`.
- `shell/Sidebar.tsx`:
  - the Reader row and its props go;
  - the sections are reordered;
  - `ClientFolders` takes the listing and a menu request;
  - Settings moves into a `sidebar-foot` after `<Machine />`. Grep before naming: `.sidebar-foot` must not
    already exist.
- `App.tsx`: `reopenReader` goes. New handlers `hideFolder`, `showFolder` and `addFolder` say their outcome through
  `say`, as `pin` and `unpin` do.
- `pages/Home.tsx`: `shownFolders`, and the new empty state.
- `pages/Settings.tsx`:
  - `ClientFolderRows` gains the switch column, the headings and Remove;
  - a `RemovedFolders` list;
  - the Add button.
- `ui/Menu.tsx`, `ui/menuKeys.ts` (moved, plus the divider), `ui/index.ts` export, and a story in
  `ui/stories/catalogue.tsx` with three states: plain, one disabled item, and a divider.
- The Nav story (`catalogue.tsx:392`) loses its Reader row.

**Docs.** They lead the build, as in every Kinas build.
- `DESIGN.md`:
  - §3.1's sidebar sentence (line 198);
  - §4's catalogue gains Menu;
  - the reader-header note (line 299: "stays the reader's own, not a library component") gets a dated amendment
    saying the menu moved into the library.
- `keymap.md`:
  - line 36 drops Reader from the click-only list;
  - a dated note: the client-folder menu handles keys only while open, with the ▾ menu's table.
- `README.md:109`: the sidebar sentence.
- `docs/smoke-test.md`: a "Folder views" section, and line 223's fresh-launch sentence.

## 5. Validation

**Rust unit tests (`projects.rs`)** must pass:
- A hidden path yields `hidden: true`, a removed one `removed: true`, a path in both reads as removed.
- An added non-git folder at depth 5 is listed; an added path already discovered is listed once.
- An added path that no longer exists is not listed and stays stored.
- An added path outside the root is not listed.
- An added `site` beside a discovered `site` names both by their path (`names_for`).
- `stored_paths` ignores junk.
- The add decision table (rule 10) is a pure function, so all four rows and the three refusals are tested without
  a dialog.

**Bun tests:**
- `folders.test.ts`: with `acme` hidden, `shownFolders` has 5 of the fixture's 6. Every other folder's `cat` equals
  its value with nothing hidden, and likewise with one removed.
- The moved `menuKeys.test.ts` passes, plus a case where the arrows skip a divider.
- `stories.test.ts`: the DESIGN.md catalogue still equals `STORIES`.

**A new e2e spec, `folders.e2e.ts` + `.setup.ts`, run alone.** It uses the fixture root of
`fixtures/projects-discovery.json` (6 folders: `acme`, `app`, `hub`, `one/site`, `two/site`, `worktree`) plus one
plain folder, `plain/`, with no `.git`.

1. The sidebar has 6 folder rows. Record every `data-cat`.
2. Dispatch `contextmenu` on `acme`. The menu's items are exactly `["Hide from sidebar", "Add a client folder…"]`.
   Choose Hide. Then:
   - the sidebar has 5 rows and Home's Overnight has 5;
   - every other row's `data-cat` is unchanged;
   - `folder_hidden` holds acme's real path.
3. Right-click `app`. The items now end with a divider and `Show acme`. Choose it: 6 rows again.
4. In Settings, turn `hub`'s "In sidebar" off: 5 rows. Remove `hub`:
   - the main list has 5 rows and Removed has 1;
   - Restore brings the sidebar back to 6, with `hub`'s switch on.
5. `KINAS_E2E_PICK_FOLDER=<root>/plain`, then Add a client folder…:
   - 7 rows, `plain` among them;
   - the notice is "Added plain".
   Adding the same folder again says "plain is already in the sidebar".
6. The pick is the root's parent: the notice is "Choose a folder inside the projects folder (…)" and there are
   still 7 rows.

**Existing assertions that change, all of them:**
- `shell.e2e.ts:108`: the rows become `["Home", "Work", "Crew", "Inbox", "Usage"]`, and the case also asserts that
  the sidebar's last element is the Settings row.
- `shell.e2e.ts:141`: "the Reader row with nothing to reopen…" is **deleted**, because the thing it tests is gone.
  It is replaced by a check that `.sidebar` holds no `aria-label="Reader"` element. Opening the panel from a file
  row stays covered by `reader-pins-a` and `reader-pins-b`.
- Nothing else is disabled, skipped or loosened. The reader menu's specs stay byte-identical (rule 17).

**The whole of it:**
- `bun run check` green.
- The full e2e suite green in one run, alone: 21 specs, where today's run has 20 and 114 cases.
- `docs/design/screens/*.png` re-taken, because every page shows the sidebar. The `fixtures/screens/*.json` style
  contracts must hold unchanged; they are page-scoped, and any one that moves is named in the commit.
- The private-names check over every added line, commit message and file name returns 0.
- By eye, in both themes:
  - Settings sits at the foot, under the VPS line;
  - Recent sits under the client folders;
  - the menu reads as part of the app, with no WebKit menu anywhere on a folder row.

## 6. Out of scope

- **The first mate's context packet** (answer 5A). A removed folder is still walked and read by
  `packages/context`, so the CLI and the packet contract stay out of this change. A follow-up can make the packet
  read `folder_removed`.
- **Deleting or trashing anything on disk.** "Remove" means "Kinas forgets it" (answer 1A).
- **Folders outside the projects folder** (answer 3B). They would need the human-click door on every relaunch.
- **Removal from the right-click menu.** Settings only, where Restore is in view (rule 16).
- **Reordering folders by dragging, renaming them, and a keyboard shortcut or palette command for any of this.**
  The menu is click-only, like every sidebar action (keymap.md).
- **Moving categories and internal from name keys to path keys** (rule 7). Today's behaviour, not this change's
  problem.
- **Anything about Pinned or Recent beyond Recent's position.**

## 7. Open questions

1. ~~Which branch this lands on.~~ Decided 2026-09-23: #24 merged first (fast-forward, `ef13b12`), then this on
   `feat/folder-views`, as its own PR.
2. **The Settings row's place at the foot — confirm by eye.** The spec puts it below the VPS line, as the very last
   row (my proposal, not contradicted). If he would rather have the VPS line last, it is a one-line swap and the
   shell spec's "last element" assertion follows it.
