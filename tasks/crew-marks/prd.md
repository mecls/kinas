# Crew marks — Implementation Spec

*2026-09-27. Written from the captain's report ("When firstmate makes changes and is working I don't see the changes in
the left side bar"), their choice to mark the crew's edits on their own tree, and their answers (1A, 2A, 3A, 4A+C; §7).
To be built from `origin/main` at `fa52b8e`. It adds to tree changes (`tasks/tree-changes/prd.md`, amended by
`tasks/tree-changes-push/prd.md`); every rule of those stands.*

## 1. Objective

The first mate's workers do not edit the captain's folder. Each works in its own worktree of a clone Kinas keeps for the
crew, under Firstmate's home (`<data dir>/firstmate/projects/<name>`), and pushes to the same GitHub repository. So while
a worker rewrites half a client's app, the captain's file tree of that client shows nothing: tree changes follows the
disk of the folder shown, and nothing on that disk moves. This change marks, on the captain's own tree, what the crew
has changed and not pushed yet. It uses the same letters as the captain's own marks, drawn with a hollow dot, so the
two never read as one. A click shows the crew's changes, read-only. Kinas still only watches: it never pulls, merges or
writes a file of the crew's, and never touches the captain's checkout.

## Announcement

Your file tree now shows what the crew is working on. When the first mate's workers change a client's files in their
own copies, the same files in your tree get a mark with a hollow dot: a hollow **M** for a file the crew is rewriting,
a hollow **A** for one it is adding, a hollow **D** for one it is removing. Click one to see exactly what the crew
changed, read-only. The marks follow the workers as they save, and go when the crew pushes. Your own marks work as
before, with a solid dot. Nothing is pulled into your folder: Kinas only watches.

## 2. Business rules (invariants — never violate)

**Whose work, and on which tree**

1. **A crew checkout is where a worker edits.** For each crew project (a folder under `<data dir>/firstmate/projects/`),
   its checkouts are the clone itself and every worktree git lists for it. Each task's worktree is where its worker
   saves.
   - A worktree that comes and goes (a task starts, a task is merged) starts or stops counting within 5 seconds.
   - The captain's own clone of Firstmate, elsewhere on this Mac, is never read (`docs/external/firstmate-home.md`).
   - *(Clarified at Gate 2, 2026-09-28.)* A worker's checkout is a git worktree of the crew clone, and it lives outside
     Firstmate's home, under `~/.treehouse`. The crew's checkouts are found from the clone's own worktree list, so this
     rule holds wherever they are.
2. **A crew project marks a tree when they are the same GitHub repository.** A file tree's repository is paired with a
   crew project when both have the same GitHub `origin`, as `owner/name`, the match the crew's lanes already use
   (`crew/repo.rs`).
   - This holds for any file tree: Files, a pinned folder, or the reader's own. It is not limited to client folders.
   - A tree whose root is below its repository's top marks only what lies under that root.
   - A repository with no GitHub `origin`, or no crew project, gets no crew marks.
3. **A crew path maps to the same path in the captain's repository.** A file at `docs/plan.md` in a crew checkout marks
   `docs/plan.md` under the captain's repository top, whatever branch either side is on.

**What a crew mark means (answer 1A)**

4. **A crew mark is what the crew has changed and not pushed.** For each crew checkout, compared with the commit its
   branch was last pushed to:
   - the branch's upstream (`@{upstream}`, else `origin/<branch>`), as tree changes clear on push reads it;
   - for a branch never pushed, where it left the remote's default branch (the merge-base with `origin/HEAD`).

   Against that commit, a path in the checkout now is:

   | At that commit | In the checkout now | Crew mark |
   |---|---|---|
   | absent | present | **A** |
   | present | absent | **D** |
   | present | present, different text | **M** |
   | present | present, the same text | none |

   Committed-but-unpushed and uncommitted edits count alike. An edit put back is no mark.

   *(Clarified at Gate 2, 2026-09-28.)* A checkout on a detached HEAD, or in a clone with no remote, counts only what
   is not committed. A checkout git cannot read gives no crew marks, never a guessed one: a false crew mark would say
   someone else changed a file.
5. **Only what the tree would list is marked.** The same filter as the captain's own marks (tree changes rule 5): no
   dot-names, no `node_modules`, `target`, `dist` or `build`, no binaries. Git-ignored files in a crew checkout are
   never marked: the crew cannot push them.
6. **Several checkouts, one mark.** When two workers change the same path, the row carries one crew mark, the strongest
   (D over M over A, as roll-ups already rank them). Its words say how many are at it (rule 10).
7. **A crew mark goes when the crew pushes.** Once the checkout's branch is pushed with that text, the path is no longer
   unpushed and its mark goes, within one second of the push. It also goes when the worker puts the file back, and
   when the task's worktree is removed.
   - Kinas knows only what the crew clone's refs say, and never fetches, as tree changes clear on push rule 3 says.
8. **Crew marks are not "since".** They describe the crew's state now, not a change since the tree was shown. So:
   - ↻ does not clear them;
   - a window reload shows them again at once, recomputed;
   - they do not join the tree's "N changes since" count.

**What the tree shows (answer 2A)**

9. **A crew mark is the Change mark with a hollow dot.** The same letter, in the same place, with the dot drawn as a
   ring (`--dot-ring`) in the same status colour (`--ok` A, `--warn` M, `--danger` D).
   - A row with both a mark of the captain's and a crew mark shows both, the crew's first, then the captain's at the
     row's end.
   - The hollow dot is the only difference in the drawing. The words say the rest (rule 10).
10. **The words say whose.**

    | The row | Words: tooltip and accessible name |
    |---|---|
    | one crew checkout changed it | "plan.md, modified by the crew, not pushed" |
    | two or more | "plan.md, modified by the crew (2 tasks), not pushed" |
    | the captain's and the crew's | "plan.md, modified since 11:44, not pushed; also modified by the crew, not pushed" |

    Added and deleted read "added by the crew" and "deleted by the crew".
11. **A file the crew added, which the captain's folder lacks, gets a row.**
    - It sits in its sorted place, as a deleted row does, its name in `--ink-3` beside a hollow **A**.
    - It is a row of the crew's, not a file on the captain's disk, and its words say so: "notes.md, added by the crew,
      not pushed — not in your folder".
    - A folder the crew added becomes one such row, with no caret. Its hollow **A** stands for everything in it, as
      an added folder's A already does.
    - *(Clarified at Gate 2, 2026-09-28.)* A crew **M** on a file the captain's folder lacks shows as such a row too,
      "not in your folder". A crew **D** on a file the captain lacks shows nothing: there is no row to mark.
12. **Folders roll up the crew too.** A folder with crew marks beneath it carries a crew roll-up: a hollow dot in the
    strongest colour and the count, beside the captain's own roll-up if it has one.
    - Its words: "docs, 3 changes by the crew inside, not pushed".
    - The count follows tree changes rule 10: an added or deleted folder counts once.
13. **The tree's head says so, once.**
    - While a tree has crew marks, one more caption line reads "The crew: 4 changes not pushed", in `--fs-xs` and
      `--ink-2`, under the captain's own "N changes since" line when that shows.
    - Nothing when there are none.

**What a click opens (answer 3A)**

14. **A crew-marked row opens the crew's changes, read-only.**
    - The reader shows the crew's version of the file on a Changes view: the checkout's text now against the text at
      the commit of rule 4.
    - The view's summary line says whose: "The crew's copy, +12 −3 not pushed". It has no "since", because it is not
      a change since a moment.
    - A deleted file shows its text at that commit, every line removed. An added one shows every line added.
    - With several checkouts, the one that changed the file last is shown, and the summary names how many
      ("1 of 2 tasks").
    - *(Clarified at Gate 2, 2026-09-28.)* "The one that changed the file last" is the checkout whose mark on that path
      Kinas saw change last.
    - The crew's file is never opened for writing, never offered to "Open in editor", and never pinned. Copy and
      Download act on the crew's text.
15. **A row with both marks opens the captain's own Changes first,** as today (tree changes rule 24). The crew's view is
    one more button in the reader header's view toggle, "The crew's", while the open file has a crew mark.

**Privacy, cost and bounds**

16. **Kinas reads the crew's checkouts; it never writes to them, and never touches the captain's.**
    - It reads only with plumbing and file reads: the worktree list, each checkout's branch and upstream, the changed
      paths, and a file's text for the view. Locks are off and nothing is written. There is no fetch, and no checkout,
      stash or reset.
    - These reads under Firstmate's home are not in ADR 0018's list. So they come with a new ADR superseding it, before
      any code (ADR 0018 says so), and `docs/external/firstmate-home.md` names them.
17. **Nothing about the crew's work is stored or logged** (ADR 0007). Marks live in memory and are recomputed. No path,
    branch, task or text reaches the log or the store. Log lines are counts and durations only.
18. **No disk or git work on the main thread; the first paint does not move** (tree changes rules 28 and 29). A crew
    mark follows a worker's save within one second, like the captain's own.
19. **Nothing remounts the terminal** (ADR 0002).

## 3. Flows

**A tree is shown whose repository the crew also has**
1. The tree's watch starts as today. Rust reads the tree's repository's GitHub `origin`, and looks under
   `<data dir>/firstmate/projects/` for a clone with the same one.
2. When one matches, Rust lists that clone's checkouts (rule 1). It works out each one's unpushed changes (rule 4)
   and starts following them: the files, and the refs that move on a push.
3. The tree draws the crew marks, the crew's added rows, the crew roll-ups and the crew caption.
4. **If Firstmate is not installed, or nothing matches,** there are no crew marks and nothing is said.

**A worker saves**
1. The crew checkout's watch fires, and the path is judged against the checkout's pushed commit (rule 4).
2. Every tree paired with that project gets its crew marks again, within one second.

**The crew pushes, or a task ends**
1. The checkout's refs move, or its worktree disappears.
2. Its unpushed set is worked out again. Marks that are pushed, or whose checkout is gone, go.

**A click on a crew-marked row**
1. The reader asks Rust for the crew's view of that path. Rust finds the checkout (the latest to change it) and reads
   the text at the pushed commit and the text now, read-only.
2. The reader shows it (rule 14), or, if the checkout has gone meanwhile, "The crew's copy is gone — its task has
   ended".

## 4. Surfaces

- **The file trees:** hollow-dot crew marks on rows, the crew's added rows, crew roll-ups, and the crew caption line.
- **The reader:**
  - the crew's Changes view, read-only;
  - "The crew's" button in the view toggle when the file also has the captain's own changes;
  - the menu with Open in editor and Pin disabled, with the reason "This is the crew's copy".
- **DESIGN.md**, before any code:
  - the Change mark gains the **crew** form (the hollow dot) and the crew roll-up;
  - the tree gains the **crew's added row**;
  - the Diff gains the crew's summary line;
  - stories for each.
- **An ADR superseding 0018**, and `docs/external/firstmate-home.md`: the new reads under Firstmate's home (rule 16).
- **keymap.md:** the view toggle's third button is click-only, as the others are.
- **README.md and docs/smoke-test.md:** the sentences, and a "Crew marks" section with the timings of §5.

**Screens:**
- `mockups/sidebar-crew.html` — a client folder's tree with the captain's own marks, crew marks, a row with both, a
  crew-added row, a folder with both roll-ups, and both caption lines; beside it, every new row state with its words.
- `mockups/reader-crew.html` — the reader on the crew's Changes view of a modified file, the view toggle on a file with
  both kinds of mark, and a crew-added file's view.

## 5. Validation

**Rust unit tests** (a temporary "captain" repository and a "crew" clone of the same bare remote, with a task worktree):
- Pairing (rule 2): the same GitHub `origin` pairs; another repository, or no GitHub remote, does not. A root below
  its top marks only under it.
- Rule 4's table, against the upstream and, for a branch never pushed, against the merge-base with `origin/HEAD`.
  Committed-unpushed and uncommitted edits alike; put back is no mark.
- Rule 5: an ignored file, a dot-file or a binary in the crew checkout makes no mark.
- Rule 6: two worktrees on one path give one mark, the strongest, with the count 2.
- Rule 7: a push clears the checkout's marks; a removed worktree clears its own.
- Rule 11: a crew-added file the captain lacks appears as a crew row; an added folder counts once.
- Nothing written: across every read, the crew clone's object count and the mtimes of its `index`, `config` and
  `FETCH_HEAD` do not change.

**The e2e spec `crew-marks.e2e.ts`, run alone.** The fixture is a bare remote, the captain's clone as the projects
root's client folder, and a fake Firstmate home whose `projects/<name>` is another clone of the same remote.
1. Files on the captain's folder shows no crew mark.
2. A task worktree of the crew clone edits `README.md`: a hollow M appears within 2 s, and its words end "by the crew,
   not pushed".
3. The worktree adds `notes.md`: a crew row with a hollow A, "not in your folder".
4. The captain edits `README.md` too: the row shows both marks, and a click opens the captain's Changes. "The crew's"
   switches to the crew's view, "+1 −0".
5. The crew commits and pushes: the crew marks go within 2 s, and the captain's own M stays.
6. ↻ leaves crew marks alone; a reload shows them again.
7. The log holds counts only: no fixture path, branch or text.
8. The PTY's pid is the same throughout.

**Timings, in `docs/smoke-test.md`:** the median, over 10 saves in a crew worktree, from the save to the hollow mark on
screen: under 1 s. The first paint of a folder in Files, unchanged within 10 %.

**The whole of it:** `bun run check` green; the full e2e suite green in one run, alone; the private-names check over
every added line and commit message returns 0.

## 6. Out of scope

- **Pulling, merging, or anything that changes the captain's checkout** (answer 4A). Kinas only watches.
- **Warnings when the captain and the crew change the same file** (answer 4C). Both marks show; nothing more is said.
- **Writing, reverting or opening the crew's files in an editor.** The crew's copy is read-only in Kinas.
- **Which worker, by name.** The words say "the crew", and how many tasks. They do not name a task (§7.2).
- **The crew's history.** Only what is unpushed now; what the crew pushed an hour ago is on the remote.
- **Crew marks outside the file trees** (Home, Crew page rows, the navigation), and for repositories with no GitHub
  remote.
- **Fetching.** A push the crew made from a checkout elsewhere is seen at the next fetch there, not before.

## 7. Open questions

1. ~~**Answer 4B was left unticked.**~~ Decided 2026-09-28: as written — crew marks go on any file tree whose repository
   has the same GitHub remote as a crew project (rule 2), a pinned subfolder included; Gate 1 was approved without a
   change. (The alternative was to limit them to the sidebar's client folders.)
2. ~~**Should the words name the task?**~~ Decided 2026-09-28: no, as written — "the crew", and a count.
3. ~~**The crew's added row**~~ (rule 11) — decided 2026-09-28: kept as written. (It could instead have shown only as a
   count on its folder.)
4. The first mate's session builds the crew's own code. The new ADR supersedes 0018, which that build wrote. The build
   will rebase over it and keep it informed.

**Asked before writing, 2026-09-27, and answered:**
- *How should you see what the crew is changing?* — **Mark crew edits on my tree.** (Others: open the crew's copy in
  Files; mark what a pull brings; leave it.)
1. What counts as a crew edit? — **A**, not yet pushed: uncommitted and unpushed, per checkout. (B: anything not in the
   captain's folder yet; C: uncommitted only.)
2. How does a crew mark look? — **A**, the same letter with a hollow dot; a row can carry both. (B: identical marks,
   words only; C: a separate list.)
3. What does a click open? — **A**, the crew's changes, read-only. (B: the captain's file as now; C: the captain's file
   against the crew's.)
4. What should it not do? — **A** no pulling or merging, **C** no conflict warnings. B (only matched folders) and D
   (nothing stored or logged) were left unticked. D stands anyway as the repository-wide ADR 0007. B is §7.1.
