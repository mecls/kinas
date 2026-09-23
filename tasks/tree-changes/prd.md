# Tree changes — Implementation Spec

*2026-09-23. Written from Miguel's request and his answers (1A, 2A, 3A, 4A, 5B+C+D, 6A; §7). To be built from
`origin/main` at `1394be7` (folder views and the design-system follow-ups merged).*

## 1. Objective

Agents change files while Miguel watches the sidebar, and today the sidebar cannot show it. A folder in a file tree
is listed once, when it is expanded (`Folder` in `app/src/reader/tree.tsx`), and never again: a file an agent
deletes is still listed, a file it creates is missing, and a file it rewrites looks exactly like one nobody touched.
This change makes every file tree follow the disk and mark what changed since the tree was loaded: **A** added,
**M** modified, **D** deleted. Each mark is a dot in a status colour plus the letter. Deleted rows stay in the tree,
struck through, until Miguel refreshes. Folders show how many changes they hold, even while collapsed. A changed
file opens on a **Changes** view, a diff against what it said when the tree was loaded. A Refresh button on each
tree clears its marks and starts counting again, without reloading the window, which would also restart the terminal
pane. A window reload or quitting clears everything. Nothing is stored and nothing touches git: this is "what changed
while I was looking", not "what is uncommitted".

## Announcement

The file tree now shows what changed. Open a folder in the sidebar and keep working. When an agent adds a file, it
appears with a green **A**. A rewritten file gets an amber **M**, and a deleted one stays in place, struck through,
with a red **D**, so nothing disappears before you have seen it go. A collapsed folder tells you how many changes are
inside it. Click a changed file to see exactly what changed since you opened the folder, line by line. A deleted file
still opens, and shows what it said. When you have seen enough, press ↻ on the tree and it is clean again. Nothing is
committed, reverted or saved: Kinas only watches.

## 2. Business rules (invariants — never violate)

**What a change is (answer 1A)**

1. **The baseline is the moment a folder's tree is first shown in this window.**
   - A folder becomes *watched* the first time any file tree with it as its root is drawn. That can be Files after
     `kinas open <dir>` or a click on a folder row, an expanded pinned folder, or the reader's own Files overlay.
   - From then until its Refresh (rule 15), a window reload or quitting (rule 17), every change under it is measured
     against how it was at that moment.
   - The baseline belongs to the root. A folder first shown at 14:02 and another at 15:10 each have their own "since".
   - Two trees with the same root (Files and the reader's overlay on the same folder) share one record.
   - Nested roots (a pinned `kinas/tasks` while Files shows `kinas`) have separate records. Refreshing one leaves the
     other's marks as they are.
   - Marks mean "since the tree was loaded", not "since the last commit", and they work in any folder, git or not.
2. **A watched folder stays watched for the rest of the window's life.** That holds when Files moves to another
   folder, and when a pinned folder is collapsed.
   - Coming back shows every change made while the folder was out of sight.
   - Otherwise a file deleted while Files showed something else would return as no row and no mark. The tree would
     look normal when it is not, which is the one thing this feature exists to prevent.
3. **Each path is compared, not replayed.** A mark says how the path differs now from the baseline, whatever
   happened in between:

   | At the baseline | Now | Mark |
   |---|---|---|
   | absent | present | **A**, added |
   | present | absent | **D**, deleted |
   | present | present, different text | **M**, modified |
   | present | present, the same text | none: saved unchanged, or edited and put back |
   | absent | absent | none, and no row: made and removed in between |

   - **Renames.** A rename is a D on the old name and an A on the new one. There is no R: FSEvents reports a rename
     as two paths, and pairing them is a guess.
   - **"The same text"** means byte-equal to the kept baseline text (rule 20).
   - **No kept copy.** Where Kinas kept no copy (rule 23), and for images, any write after the baseline marks the
     file M. Kinas cannot tell an unchanged save from a change there, and "modified" when unsure is safer than
     silence.
4. **Folders are marked by existence only.**
   - A folder absent at the baseline and present now is **A**, and so is everything the tree lists inside it.
   - A folder present at the baseline and absent now is **D**.
   - A folder that exists at both moments has no letter. It carries a roll-up instead (rule 10).
   - A path that changed kind (a file replaced by a folder of the same name, or the reverse) shows as the new kind,
     marked A.
5. **Only what the tree would list is ever marked** (answer 5D). The tree's own filter decides: `list_dir` in
   `app/src-tauri/src/reader/mod.rs`. None of the following makes a mark, a row or a roll-up count:
   - a dot-name, and so anything under `.git`;
   - anything named in `SKIPPED_NAMES` (`node_modules`, `target`, `dist`, `build`), or anything beneath one;
   - a binary file (a file is listed only when `reads_as_text` or `access::is_image` says so);
   - anything `access::permitted` refuses.

   A deleted file is judged by what it was at the baseline. A text file that is deleted is a D row, even though it
   can no longer be sniffed.
6. **Changes are watched under the root's real path.** A symlinked folder that leads outside the root is listed as
   today but never marked. Following it would mean watching a place Miguel never opened.
7. **The tree follows the disk.**
   - An expanded folder re-lists when something inside it changes.
   - An added row appears in its sorted place: folders first, then by name, as `list_dir` sorts.
   - It appears **within one second** of the change on disk. The events are debounced 75 ms, as the reader's live
     reload already is (`reader/watch.rs`, `DEBOUNCE`).

**What the tree shows (answers 3A, 4A)**

8. **A marked row carries a dot and a letter** at the right end of the row, before the folder actions that appear on
   hover. The dot is the Dot component, solid, `--dot` across. The letter is `--fs-xs` mono in `--ink-2`.

   | Change | Dot | Letter | Words (tooltip and accessible name) |
   |---|---|---|---|
   | added | `--ok` | A | "new-note.md, added since 14:02" |
   | modified | `--warn` | M | "overview.md, modified since 14:02" |
   | deleted | `--danger` | D | "old-plan.md, deleted since 14:02" |

   - The name keeps the tree's colours: `--ink-2`, and `--ink` with the `--line` fill when it is the open file.
   - Status colours are never text (DESIGN.md §2.2). `--warn` as text measures 3.2:1 where text needs 4.5, and the
     letter says in a word what the dot says in colour (§7, "words with color").
   - The accent is never a mark. It means selected, and a changed row that is open shows both.
9. **A deleted row stays where it was, its name struck through**, until Refresh, a reload or quitting.
   - It can be clicked, and opens on what the file said at the baseline (rule 22).
   - A deleted folder is one struck-through row with no caret. It does not expand, because Kinas does not know
     everything it held, and its D stands for the folder and everything in it.
10. **A folder with changes beneath it shows a roll-up** when it existed at both moments.
    - The dot is the colour of the strongest change beneath: deleted over modified over added, because a deletion is
      the change least likely to be noticed any other way.
    - Beside it is the number of changed entries beneath, `--fs-xs` mono in `--ink-2`.
    - The roll-up shows whether the folder is collapsed or expanded.
    - An added or deleted folder counts once, not once per file inside it. The count answers "how many things to
      look at".
    - Past 99 the count reads "99+".
    - Its words: "docs, 3 changes inside since 14:02".
11. **A tree's head says when, once** (DESIGN.md §1, principle 4).
    - While a tree has at least one mark, one caption line under its head reads "5 changes since 14:02", in
      `--fs-xs` and `--ink-2`.
    - The count is every changed entry under the root, counted as in rule 10.
    - The time is the baseline, local, HH:MM.
    - With no mark, there is no caption.
12. **Marks show in every file tree and nowhere else** (answer 5C). The file trees are every mount of `FileTree`:
    - the sidebar's Files section;
    - each expanded pinned folder;
    - the reader's own Files overlay, shown when the window is narrow and the sidebar is hidden.

    Pin rows, Recent, the Client folders rows and Home show nothing.
13. **The cap stays the cap.** A folder still lists at most `LIST_CAP` (2000) entries and "N more not shown".
    Changes among the ones not shown count in the roll-ups and the caption, but have no row to mark.
14. **Nothing here remounts the terminal** (ADR 0002). Marks, re-listing and Refresh happen inside the sidebar and
    the reader. Nothing above `<Terminal>` becomes conditional, wrapped or re-keyed, and the PTY's pid is the same
    before and after every one of them.

**Clearing (answer 2A)**

15. **Refresh clears one tree's record and starts a new baseline now.**
    - **Where it is:** a ↻ button, `--hit` square like the terminal and pin buttons beside it, on the head of each
      tree. That is the Files section's header, and an expanded pinned folder's row.
    - **When it shows:** always while that tree has marks, and only on hover otherwise.
    - **Its words:** the label is "Refresh docs". The tooltip is "Refresh docs: clear its changes and start
      counting again".
    - **What pressing it does:** every mark under that root goes, deleted rows go, expanded folders re-list, and the
      caption goes. The baseline becomes this moment, and the kept copies are taken again (rule 20).
    - Other roots' marks are untouched.
16. **The palette has "Refresh files".**
    - It does exactly what the Files header's button does, for the folder Files shows.
    - Run with no folder in Files, it changes nothing and says "No folder in Files to refresh".
    - It has no chord. Sidebar actions are click-only (keymap.md, Sidebar), and the palette is their keyboard path.
17. **A window reload or quitting clears every record**, as if no folder had ever been watched. After a reload, each
    tree shows the disk as it is, unmarked, from a fresh baseline.
    - A reload is WebKit's right-click Reload. Today it also restarts the terminal pane: `PtyState::start` in
      `pty.rs` ends the old session on every load.
    - This change leaves that alone. It is the reason Refresh exists.
18. **Nothing else clears a mark.** Opening a changed file does not, and neither does collapsing its folder,
    switching Files to another folder, committing in git, or waiting (2A over 2C).

**The diff (answer 6A)**

19. **A changed text file has a third view, Changes**, beside Rendered and Source in the reader header's view toggle
    (`.reader-view`, `Header.tsx`).
    - It exists only while the open file has a mark.
    - A file with no rendered form, which has no toggle today, gets one with Source and Changes.
    - For a deleted file, Changes is the only view.
20. **The diff is against the file's text at the baseline**, the moment the marks count from. So an M always shows
    the edits that earned it. Kinas keeps that text for each listed text file under the root, taking it when the root
    starts being watched.
    - **Inside a git repository** (the nearest `.git` above the file, even above the tree's root):
      - A file whose working text equals HEAD at the baseline is not copied. Its baseline text is the blob at the
        HEAD commit recorded at the baseline, as a checkout would write it, with filters and line endings applied.
      - Every other listed text file is copied: one that differs from HEAD, one that is untracked, and one that git
        ignores but the tree lists (like Kinas's own `tasks/`).
    - **Outside any repository**, every listed text file is copied.
    - **The budget.** Copies are held in memory only, within one budget for the whole window: 64 MB of text across
      every watched root. No file over `MAX_TEXT_BYTES` (4 MB, the reader's own ceiling) is copied. A file left out
      still gets its mark, and its Changes view says why it has no diff (rule 23).
    - **How git is read.** Plumbing only, optional locks off, nothing ever written to a repository, as the context
      packet reads projects (`packages/context/src/sources/projects.ts`). If git cannot run, the folder is treated as
      outside any repository.
21. **The diff reads like the reader.**
    - **The layout.** Unified, in one column:
      - two line-number gutters, before and now, in `--fs-xs` mono `--ink-2`;
      - a sign gutter holding +, − or nothing;
      - then the line, in the source view's mono and highlighting.
    - **The colours.** An added line sits on a faint `--ok` tint with +, and a removed line on a faint `--danger` tint
      with −. The sign says in a word what the tint says in colour.
    - **Context.** Three lines around each change. A longer unchanged run folds into one row, "40 unchanged lines",
      which expands in place when clicked.
    - **Wrapping.** Long lines wrap, unlike Source, which scrolls: a diff is for reading, not for copying column by
      column.
    - **The summary.** One line above the diff: "+12 −3 since 14:02".
22. **Added and deleted files.**
    - An added file's Changes shows every line as added.
    - A deleted file opens on Changes: every line of its baseline text as removed, under the line "Deleted since
      14:02 — what it said then".
    - For a deleted file, Copy and Download act on that old text, which is how a deleted file is rescued. Print, Open
      in editor and Pin are disabled, with the reason "This file was deleted".
23. **A diff is never guessed.** Where Kinas holds no baseline text, Changes shows one line in its place, and the
    mark stays:
    - "Kinas kept no copy of this file from 14:02, so there is nothing to compare —"
    - followed by the reason: "the folder holds more text than Kinas keeps", "it is larger than 4 MB", or "it
      changed while Kinas was taking its copies".

    Images have marks but no Changes view, because no copy of an image is kept. A deleted image's row opens to
    "This image was deleted; Kinas keeps no copy of images".
24. **Clicking a marked row opens the file on Changes**, and clicking an unmarked row opens it as today.
    - The toggle switches views from there. The choice is not carried to the next file: the next marked file opens
      on Changes again.
    - This is the least sure decision in the document (§7).
25. **The diff follows the file.**
    - While Changes shows, each save re-diffs inside the reader's live reload (R29), and the scroll position holds
      as it does for any reload.
    - If the file goes back to its baseline text, its mark goes. The reader drops to the file's usual view, and the
      status line says "No changes since 14:02 any more".
    - A diff that takes longer than 500 ms to compute shows "Too many changes to show — 1,204 lines then, 980 now"
      instead.

**Privacy and cost**

26. **Nothing about changes is stored or logged.**
    - Marks, baselines and copies live in memory and end with the window load.
    - No path and no file text reaches the store, the disk or the log (ADR 0007).
    - The log holds counts, byte totals and durations only: `tree changes: watching a folder, 412 copies, 3.1 MB,
      180 ms`.
27. **Rust decides; the webview shows.**
    - Every path the webview asks about (a mark, a diff, a refresh) is rechecked in Rust, as every reader path is
      (ADR 0009).
    - The comparison, the diff and the words of every refusal come from Rust.
28. **No disk work on the main thread.** Taking copies, comparing, re-listing and diffing run off it (`off_main`, as
    `reader_list_dir` does). The tree never waits for the copies: it lists at once as today, and marks begin at
    once.
29. **The first paint does not move.** Opening a folder shows its tree as fast as today: the smoke test's warm open
    was 46 ms on 2026-09-23. Taking the copies happens after.

## 3. Flows

**A folder starts being watched**
1. A `FileTree` mounts on root R. The webview asks Rust to watch R.
2. Rust rechecks R (ADR 0009).
   - If R is already watched in this window load, Rust returns its record: the baseline time and every current mark.
   - Otherwise Rust records the baseline time, starts one recursive watch on R's real path, and starts taking the
     copies in the background (rule 20).
3. The tree lists R as today and draws whatever marks came back.
4. **If the watch cannot start** (the notify crate refuses): the tree works as today, without marks. Its caption
   reads "Not following changes in docs", and the log says why, with no path. No retry: a Refresh tries again.
5. **If one file cannot be copied**, that file has no copy (rule 23) and the rest carry on.

**Something changes on disk**
1. The watch fires. Rust debounces for 75 ms.
2. Rust drops paths the tree would not list (rule 5), then compares each remaining path with the baseline (rule 3).
3. Rust sends the webview the changed paths' marks and the root's new totals.
4. The webview redraws the affected rows, re-lists each affected expanded folder, and updates the roll-ups and the
   caption.
5. If the open file's mark changed, the reader's view toggle follows it (rules 19 and 25).

**Opening a changed file**
1. Miguel clicks a marked row, and the reader opens the file on Changes (rule 24).
2. Rust rechecks the path, finds the baseline text (a kept copy, or the HEAD blob), reads the current text off the
   main thread, and diffs the two.
   - If there is no baseline text, it sends the refusal of rule 23.
   - If the diff runs past 500 ms, it sends the refusal of rule 25.
3. The webview renders the diff, or Rust's words.

**Refresh (the button, or "Refresh files" in the palette)**
1. The webview asks Rust to refresh R.
2. Rust drops R's marks and copies, sets the baseline to now, and starts the copies again.
3. The webview clears the marks, removes deleted rows, re-lists the expanded folders, and hides the caption.
4. If the open file was deleted, the reader shows what it shows today for a file that has gone. If it was changed,
   the reader drops to its usual view.

**A window reload**
1. As the page loads, the webview tells Rust it is starting fresh. Rust drops every record, every watch and every
   copy.
2. Each tree starts watching again as it mounts, from a new baseline.

## 4. Surfaces

- **The sidebar's file trees** (`app/src/reader/tree.tsx`, `app/src/shell/Sidebar.tsx`):
  - the marks on rows, the roll-ups on folders and the struck-through deleted rows;
  - the ↻ on the Files header and on each expanded pinned folder's row;
  - the "N changes since HH:MM" caption under a tree's head.
- **The reader** (`app/src/reader/Header.tsx`, `Reader.tsx`):
  - Changes in the view toggle;
  - the diff body;
  - the deleted file's view, and the refusal lines of rules 23 and 25.
- **The palette**: "Refresh files", in the command registry (`packages/commands/src/registry.ts`), palette door only.
- **DESIGN.md** comes first, before any code:
  - §4 gains a **Change mark**: the dot and letter, the folder roll-up, the deleted row, and a story for each.
  - §4 gains a **Diff**: the gutters, the tints, the folded run, the summary line and the refusal line, with stories.
  - §2.2 gets a dated amendment: a faint status tint behind a diff line is allowed in the Diff only.
  - §2.4 gets the measured contrast of `--ink` on both tints, in both themes.
  - The ↻ icon is drawn on the 16 grid in `app/src/ui/icons.tsx`.
- **keymap.md**:
  - The Sidebar section notes that Refresh is click-only and that the palette has "Refresh files".
  - The Reader section notes that Changes is click-only, like Rendered and Source.
- **README.md and docs/smoke-test.md**: the sidebar and reader sentences, and a "Tree changes" section with the
  timings of §5.

**Screens:**
- `mockups/sidebar-tree.html` — the sidebar with Files open on a folder with one of each mark, a collapsed folder's
  roll-up, a deleted row, the ↻ and the caption; beside it, every row state with its words.
- `mockups/reader-changes.html` — the reader panel on a modified file's Changes view, with a folded run; below it,
  a deleted file's view and the no-copy refusal.

## 5. Validation

**Rust unit tests:**
- Rule 3's table as a pure function: every row, including "edited and put back → none" and "made and removed →
  none".
- Folders (rule 4): an added folder and the files in it are A; a deleted folder is D; a file replaced by a folder
  shows as the folder, marked A.
- The filter (rule 5): a change in `.git/`, `node_modules/x.md`, `.hidden.md` or a binary makes no mark and adds
  nothing to any count.
- Roll-ups (rule 10): colour precedence D over M over A. A new folder holding 10 new files counts 1. 150 changes read
  "99+".
- Baselines (rule 20), in a temporary git repository:
  - a clean tracked file is not copied, and its baseline text equals HEAD's blob;
  - a file differing from HEAD is copied, and so are an untracked file and an ignored but listed file;
  - with the budget set to 1 KB, the file past it has no copy and gives rule 23's words.
- The diff: a fixture before/after pair gives the exact expected hunks, with three lines of context and a 40-line
  unchanged run folded into one row.

**A new e2e spec, `tree-changes.e2e.ts` with its setup, run alone.** The fixture root holds `repo/` (a git
repository with committed `README.md` and `docs/old.md`, and an ignored `notes/`) and `plain/`, a folder with no git.
1. Open `repo` in Files. There are no marks and no caption.
2. Write `repo/new.md`. Within 2 s its row shows A, its accessible name contains "added since", and the caption reads
   "1 change since" followed by the baseline time.
3. Append a line to `repo/README.md`: M. Click it, and the reader opens on Changes with "+1 −0", the new line carrying
   +.
4. With `docs/` collapsed, delete `repo/docs/old.md`. `docs` shows a `--danger` dot and "1". Expand it: `old.md` is
   struck through with D. Click it, and the diff shows as many removed lines as the file had.
5. Write `README.md` back to its committed text. Its M goes within 2 s.
6. Switch Files to `plain`, delete `repo/new.md`, then switch back. `new.md` is gone and has no row, since it was made
   and removed. `old.md` is still D.
7. Refresh. There are no marks and no caption, and the `old.md` row is gone.
8. The PTY's pid is the same across steps 1–7.
9. A change to `repo/node_modules/x.md` or `repo/.hidden.md` makes no mark.
10. Last, and alone in its own case: `location.reload()`. Every mark is gone.

**Timings, recorded in `docs/smoke-test.md`:**
- The median, over 10 writes, from the write on disk to the mark on screen: under 1 s (rule 7).
- The warm open of a folder in Files: within 10 % of 46 ms (rule 29).
- The Kinas repository opened in Files: the number of copies, their bytes and how long they took.

**The whole of it:**
- After the e2e run, the app's log contains no fixture path and no fixture text (rule 26).
- `bun run check` green.
- The full e2e suite green in one run, alone.
- The stories and the contrast test cover the new components in both themes.
- The private-names check over every added line, commit message and file name returns 0.

## 6. Out of scope

- **Git actions**: stage, commit, revert, discard (answer 5B). Kinas only watches.
- **Marks outside the file trees**: pin rows, Recent, Client folders rows, Home, the navigation's counts (answer 5C).
- **Marks for what the tree hides**: dot-names, `node_modules`, `target`, `dist`, `build`, binaries (answer 5D).
- **"Uncommitted" marks from git status** (answer 1A). A later feature could show them beside these; this one is
  "since I opened it".
- **Marks surviving a reload or a relaunch.** Clearing on reload is the design, not a gap.
- **R for renames** (rule 3), **image diffs**, **side-by-side diffs** and **highlighting the changed words inside a
  line**. The diff is line by line and unified.
- **Editing, reverting or accepting from the diff.** The reader only reads, and the one thing it ever writes is the
  copy asked for.
- **Watching folders that were never shown as a tree.** A client folder that was never opened is not watched.
- **Marks in the terminal or the CLI.** `kinas open` prints what it prints today.

## 7. Open questions

1. ~~**Rule 24: does a click on a marked row open Changes, or the file's usual view?**~~ Decided 2026-09-23: Changes,
   as written — Gate 1 was approved without a change. (The case against: if Miguel mostly clicks a rewritten
   markdown file to read it rendered, the usual view with Changes one click away would be better.)
2. ~~**Rule 11's caption, "5 changes since 14:02".**~~ Decided 2026-09-23: kept, as mocked — Gate 1 was approved
   without a change. It costs one line of the sidebar's height while marks exist.
3. **Rule 20's 64 MB budget** is a guess. In a git repository only files with uncommitted or ignored text are copied,
   so a typical client repository fits many times over. A folder outside git, or the projects folder itself opened in
   Files, may spend it on the first folders walked. Gate 2 measures the Kinas repository and the projects folder, and
   decides the number and the order the copies are taken in.

**Asked before writing, 2026-09-23, and answered:**
1. What is a change compared against? — **A**, the moment the tree was loaded; a reload clears every mark. (B was
   git's last commit; C was both.)
2. What clears the marks? — **A**, a Refresh button on the tree plus a palette command; reload and quit clear
   everything. (B was reload only; C added "opening a changed file clears it".)
3. What does a mark look like? — **A**, a status-coloured dot plus the letter in grey; deleted rows stay, struck
   through. (B was coloured letters and names, against DESIGN.md; C added a row tint.)
4. How do folders show changes? — **A**, their own A or D, and a dot with a count of changes inside, even collapsed.
   (B watched expanded folders only; C had no roll-up.)
5. What should it deliberately not do? — **B, C and D**: no git actions, no marks outside the trees, no marks for what
   the tree hides. **A was left in**: the diff view is in scope.
6. What does the diff compare against? — **A**, the same moment the marks count from, with Kinas keeping the old text
   (from git where it can, copies otherwise). (B was git's last commit; C was the first open in the reader; D was no
   diff for now.)
