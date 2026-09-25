# Tree changes clear on push — Implementation Spec

*2026-09-25. Written from the captain's request and answers (1A, 2A, 3A; §7). To be built from `origin/main` at
`c5209fa`. It changes the shipped tree changes (`tasks/tree-changes/prd.md`, "the tree changes PRD" below). Its
rules 15, 16 and 18, its answer 1A and its §6 line on git are amended here. Every other rule of it stands.*

## 1. Objective

The file trees mark what changed on disk (A, M, D) since each tree was first shown. Today only ↻, "Refresh files"
or a window reload clear those marks, and ↻ clears all of them at once, whatever became of the change. The captain
works as agents edit, commit and push. For them a change stops needing attention once it is pushed, so marks that
outlive the push are noise, and a ↻ that wipes unpushed work with them hides the one thing still worth seeing. This
change makes a mark go on its own when the text it marks is on the branch's remote. It also makes ↻ clear only what
no push will ever clear: what is already pushed, what git ignores, and folders git does not hold. Kinas still only
watches. It never pushes, pulls or fetches.

## Announcement

Marks in the file tree now go away when you push. Edit a file and it's marked M, as before. Commit it and the M
stays. Push it and the M goes within a second, because the change is safely on the remote. A mark that's waiting for
a push says so: "overview.md, modified since 14:02, not pushed". ↻ now clears only what's already pushed or can never
be pushed, such as ignored files and folders outside git. Unpushed work stays marked until it's pushed.

## 2. Business rules (invariants — never violate)

**What "pushed" means (answer 2A)**

1. **A repository's remote is its branch's upstream.**
   - The upstream is the checked-out branch's upstream (`@{upstream}`, as `git status` and the context packet read
     it). If the branch has none, it is `origin/<the branch's name>` if that ref exists.
   - Otherwise the repository has no remote to push to yet:
     - a branch never pushed waits for its first push;
     - a repository with no remote at all, or a detached HEAD, **cannot push** (rule 9).
   - A path belongs to the deepest repository above it, as the tree changes PRD's rule 20 already finds it. That
     includes a folder under the root holding its own `.git`, and a root that is a worktree.
2. **A path is pushed when it matches its upstream's commit now.**

   | Now on disk | At the upstream's commit | Pushed? |
   |---|---|---|
   | a file | a file with the same text (git's hash of the file now equals the blob) | yes |
   | a file | a different text, or nothing | no |
   | nothing (deleted) | nothing | yes |
   | nothing (deleted) | a file or a folder | no |
   | a folder | a folder (a tree) | yes, for the folder's own mark (rule 6) |

   "The same text" is git's own judgement, with the repository's filters and line endings applied. So a file saved
   with CRLF in a repository that normalises line endings counts as pushed when git says so.
3. **Kinas knows only what this Mac's refs say.**
   - A `git push` from any checkout or worktree of the repository updates the remote-tracking ref here, and Kinas
     sees it.
   - A push from another machine, or a pull request merged on GitHub, is not seen until a `git fetch` or `git pull`
     here.
   - Kinas never fetches. It reads the local repository only, with plumbing, locks off, and never writes to it (the
     tree changes PRD's rule 20).

**When a mark clears on its own (answers 2A and 3A)**

4. **A moved upstream checks every mark in that repository again.**
   - When a repository's remote-tracking refs change (a push, a fetch, a pull), each marked path in it, in every
     watched tree, is checked against rule 2.
   - A pushed path loses its mark, and a deleted row that is pushed leaves the tree.
   - This happens **within one second** of the ref changing on disk, the same budget as the tree changes PRD's
     rule 7.
5. **Committing is not pushing.** A commit, an amend or a rebase moves no remote-tracking ref, and leaves every mark
   as it is. So does a push to some other branch.
6. **An added folder** loses its A when its upstream has a folder there.
   - Everything the tree lists inside it is then judged one path at a time, by the same rules as any other path.
   - What is pushed is unmarked. What is not pushed, or is ignored, is marked A on its own row.
   - Before that moment, the folder's A still stands for everything in it, as the tree changes PRD's rule 4 says.
7. **What a push clears becomes the new "normal" for that path.**
   - The path's baseline becomes its upstream's text, and its "since" becomes the moment the push was seen.
   - A later edit marks it again. Its Changes view diffs against the pushed text: "+2 −0 since 15:31".
   - Paths the push did not clear keep their baseline and their "since".
8. **Text that is already on the remote is never marked (answer 3A).**
   - A file that changes on disk to exactly its upstream's text gets no mark, and takes that text as its new
     baseline. The usual cases are a `git pull`, a `git checkout` or a `git reset` onto what was pushed.
   - The same holds for a file deleted on disk that its upstream does not hold either.
   - So after a pull, the pulled files show nothing: their text is already on the remote, and a mark means
     "changed here and not yet on the remote".

**What ↻ does now (answer 1A)**

9. **↻ and "Refresh files" check again, and clear what no push will clear.** For every mark under that tree, it
   decides again:
   - **pushed** (rule 2): cleared;
   - **git cannot push it**: cleared. That means a path git ignores (the captain's private `tasks/*/` documents, for
     one), a path outside any repository, or a path in a repository that cannot push (rule 1);
   - **waiting for a push**: kept. That is a tracked file, or an untracked one git does not ignore, in a repository
     that can push.

   A cleared path starts counting again from that moment (rule 7).
   - A ↻ that clears every mark leaves the tree exactly as today's ↻ does: no marks, no deleted rows, no caption.
   - This replaces the tree changes PRD's rule 15 ("every mark under that root goes") and rule 16. The palette
     command still does exactly what the Files head's ↻ does.
10. **↻ is where it was, as it was.**
    - It sits on each tree's head, a `--hit` square.
    - It shows always while the tree has marks, and on hover otherwise, even when every mark is waiting for a push.
      Its second job is to check again when a push was not seen, say because the notify watch dropped it.
11. **Nothing else clears a mark.** The tree changes PRD's rule 18 stands, less "committing in git". Opening a
    changed file, collapsing its folder, switching Files to another folder and waiting still clear nothing. A window
    reload or quitting still clears everything.

**What the tree says (the words)**

12. **Every mark has its own "since".**
    - A row's words and its Changes view say the time that path's baseline was taken: the tree's first showing, or
      the push or ↻ that last cleared it.
    - A folder's roll-up and the caption under a tree's head say the **earliest** "since" among the marks they
      count: "3 changes since 11:44".
13. **A mark that is waiting for a push says so.**

    | The mark | Words: tooltip and accessible name |
    |---|---|
    | waiting for a push (rule 9) | "overview.md, modified since 11:44, not pushed" |
    | git cannot push it | "build-spec.md, modified since 11:44", as today |
    | outside any repository | "notes.md, added since 11:44", as today |
    | modified again after a push was seen at 15:31 | "overview.md, modified since 15:31, not pushed" |

    - The dot and the letter do not change. "Not pushed" is words only, because it explains a mark rather than
      being one.
    - A roll-up keeps today's words: "docs, 3 changes inside since 11:44".
14. **↻'s words say what it clears.**
    - Its label stays "Refresh docs".
    - Its tooltip becomes "Refresh docs: clear what's pushed or can't be pushed".
    - Where no repository is involved, what it clears is everything, as today.
15. **"Refresh files" reports what stayed.**
    - When marks are left waiting for a push, the palette answers "2 changes not pushed yet" (singular "1 change
      not pushed yet").
    - When nothing is left, it answers nothing, as today.
    - With no folder in Files, it answers "No folder in Files to refresh", as today.

**Unchanged, and still invariants**

16. **Nothing about this is stored or logged beyond counts.**
    - The log gains one line per check that cleared something: `tree changes: a push cleared 3 marks in 40 ms`.
    - No path, no branch name, no remote name and no commit reaches the log or the store (ADR 0007).
17. **Rust decides; the webview shows.** The pushed check, the upstream, "can't be pushed" and the words' inputs are
    Rust's. Every path is rechecked there (ADR 0009).
18. **No disk or git work on the main thread,** and the first paint does not move (the tree changes PRD's rules 28
    and 29). The check runs after the ref changes, off the main thread, and a tree lists at once as today.
19. **Nothing remounts the terminal** (ADR 0002). A push seen, a ↻ and a re-check happen inside the sidebar and the
    reader, and the PTY's pid is the same before and after.

## 3. Flows

**A push is seen**
1. The captain, or an agent, runs `git push` in a repository a watched tree covers. Git updates the
   remote-tracking ref (`refs/remotes/…`, or `packed-refs`) in the repository's common git folder.
2. Kinas's watch on that git folder fires. Rust debounces it for 75 ms and reads the upstream's commit again. If it
   did not move, it stops there.
3. For every watched root with marks in that repository, Rust checks each marked path against the new commit
   (rule 2). It clears what is pushed, rebaselines it (rule 7), and emits each changed root's summary.
4. The trees redraw. If the open file's mark went, the reader drops to its usual view with "No changes since 11:44
   any more", as it does today when a file is written back.
5. **If git cannot run, or the upstream cannot be read,** nothing clears, and the log says so without a path. ↻
   still works as rule 9 says, judging with whatever git could answer.

**A pull**
1. The fetch half moves the remote-tracking ref, and the check runs. Usually nothing is marked yet.
2. The merge half rewrites files on disk. Each burst is judged as today. Any path whose text now equals its
   upstream's is unmarked and rebaselined (rule 8).

**↻, or "Refresh files"**
1. The webview asks Rust to refresh the root.
2. Rust reads each involved repository's upstream, and asks git which marked paths it ignores. It then judges every
   mark by rule 9.
3. Rust clears and rebaselines what goes, and returns the root's new summary. With no mark left, the root's
   "since" becomes now.
4. The palette's command answers rule 15's line.

**A window reload** clears everything, as today.

## 4. Surfaces

- **The sidebar's file trees** (every mount of `FileTree`: the Files section, each expanded pinned folder, and the
  reader's own Files overlay):
  - marks clear on a push;
  - the words of rule 13;
  - the caption's earliest "since";
  - ↻'s tooltip.
- **The reader:**
  - the Changes view's summary and the deleted file's lead line say that path's own "since";
  - the header's Changes button title says the same.
- **The palette:** "Refresh files" answers rule 15's lines.
- **DESIGN.md**, before any code:
  - the Change mark note: marks clear on a push, and the words gain ", not pushed";
  - the Diff note: "since" is the path's own;
  - a changelog entry.
  - No component, token or story is added. The catalogue's Change mark stories gain the words, where they show
    them.
- **keymap.md:** the Sidebar line on ↻ says what it now clears.
- **README.md:** the tree changes sentences.
- **docs/smoke-test.md:** the Tree changes section, plus the push-to-clear timing.

**Screens:**
- `mockups/sidebar-push.html` — one tree at four moments: edited and committed, after `git push`, edited again
  after the push, and after ↻. Beside it, every new word.

## 5. Validation

**Rust unit tests**, each in a temporary repository with a bare remote (`git init --bare`, `git push -u`):
- The pushed table (rule 2), as a function over a real repository: the same text, a different text, deleted on
  both sides, deleted here only, and a folder.
- The upstream (rule 1):
  - `@{upstream}` when set;
  - `origin/<branch>` when not set;
  - none on a branch never pushed;
  - "cannot push" with no remote and on a detached HEAD.
- Seen pushes:
  - edit, then commit: the M stays;
  - push: the M goes, and the path's baseline is the pushed blob, with "since" the moment the push was seen;
  - edit again: M, and the diff is against the pushed text.
- A push to another branch clears nothing.
- A pull from a second clone rewrites a file to the upstream's text: no mark.
- A deleted file, pushed: its D row goes. An added folder, pushed with one file inside left unpushed: the folder's
  A goes, and the file inside is A.
- ↻: in one tree holding an ignored file, a tracked unpushed file, a pushed file and a nested repository with no
  remote, only the tracked unpushed file keeps its mark.
- A root below its repository's top, and a root that is a worktree: a push is seen in both.
- The log after all of it holds counts only.

**The e2e spec `tree-changes.e2e.ts`, run alone.** The setup gains a bare remote beside the fixture, and
`repo/`'s `main` is pushed to it with an upstream.
1. Edit `README.md`: M, and its words end ", not pushed".
2. Commit it: still M after 2 s.
3. Push it: the M goes within 2 s, and the caption goes with it.
4. Edit it again: M "since" the push's time, and Changes shows only the new line.
5. Write `notes/x.md`, which git ignores: A, with no ", not pushed". ↻: `notes/x.md` clears, `README.md` stays M,
   and the palette's "Refresh files" answers "1 change not pushed yet".
6. From a second clone, push a change to `docs/other.md`, then `git pull` in `repo/`: no mark on `docs/other.md`.
7. Today's case 7 (↻ clears the tree) is rewritten to rule 9. `tree-changes-no-git` passes unchanged, because
   with no git, ↻ clears everything.
8. The PTY's pid is the same throughout.

**Timings, recorded in `docs/smoke-test.md`:**
- the median over 10 pushes, from `git push` exiting to the mark gone from the screen: under 1 s (rule 4);
- the first paint of a folder in Files, unchanged within 10 % (rule 18).

**The whole of it:**
- `bun run check` green.
- The full e2e suite green in one run, alone.
- The log grep finds no fixture path, branch or remote name.
- The private-names check over every added line, commit message and file name returns 0.

## 6. Out of scope

- **Kinas pushing, pulling or fetching.** It only watches, and a fetch would reach the network (rule 3).
- **Watching the remote itself.** A push from elsewhere is seen at the next fetch here, not before.
- **Ahead and behind counts, branch names, or a "committed, not pushed" mark.** A mark stays A, M or D. The words
  say "not pushed", and nothing more about git's state.
- **Partly pushed files.** A file is pushed or not, as a whole. There are no hunks.
- **Marks for pushed changes that happened while no tree was watching.** Marks still start at the tree's first
  showing. A pushed change is simply one that stops being marked.
- **Marks outside the file trees**, as in the tree changes PRD.
- **A setting to turn this off.** If the captain wants the old ↻ back, it is a new decision.

## 7. Open questions

1. ~~**Rule 14's tooltip words**, "clear what's pushed or can't be pushed".~~ Decided 2026-09-25: kept as written;
   Gate 1 was approved without a change.
2. ~~**Rule 10: should ↻ stay shown when every mark is waiting for a push?**~~ Decided 2026-09-25: yes, as written,
   because it doubles as "check again". (The case against: a button that visibly does nothing when pressed.)

**Asked before writing, 2026-09-25, and answered:**
1. What clears marks on files git will never push (ignored files, folders outside any repository)? — **A**, ↻ clears
   them. (B was only a window reload; C was not marking them at all.)
2. Which push counts? — **A**, the branch's remote: the file's text equals the current branch's upstream, else
   `origin/<same name>`. (B was the default branch only.)
3. A pull rewrites files with text that is already on the remote. Mark them? — **A**, no: a mark means "changed
   here and not yet on the remote". (B was marking them until ↻.)

No scope question was asked. §6 is this document's proposal, for the captain to change at this gate.
