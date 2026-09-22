# Kinas · how agents work here

Kinas is built documents first, in tested slices, with real tests and reviewable diffs. The workflow is the
four-gate software factory vendored at `.claude/skills/software-factory/SKILL.md` — Product, Architecture,
Program design, Vertical slices — with the captain's explicit approval at every gate before implementation
code exists. Where this file and the skill differ, this file wins.

## The resume rule

At the start of any session, if `tasks/<feature-slug>/status.md` exists for the feature being discussed, read
every document in that folder first, then continue from the first unapproved gate or the first unchecked
slice. Never redo an approved gate unless the captain asks or a later gate invalidated it; in that case set
the earlier gate back to "in progress", update its document, and get re-approval before continuing.

## The approval protocol, at every gate

Write the document to disk. Present at most ten bullet decisions and the path, never the whole document.
Ask exactly: **"Approve Gate N, or what should change?"** Approval is a clear yes; anything else is a revision,
then ask again. On approval mark the gate `APPROVED <date>` in `status.md`.

## Compaction at every boundary

At the end of every gate and every slice, the documents must contain everything decided; nothing important
may exist only in chat. Then say, in one line, that this is a safe point to start a fresh session. If the
harness warns that context is running low, compact immediately, wherever the work is.

## What skips the gates

Trivial changes (a rename, a copy change, a one-line config edit, anything the captain says to just do) skip
the gates. If it is unclear whether a change qualifies, ask once.

## Where the documents live

The skill's `docs/plans/<slug>/0N-*.md` layout maps to `tasks/<feature-slug>/` like this; the skill file is
never edited to say so.

| Kinas file | Skill file | Gate | In git |
|---|---|---|---|
| `status.md` | `00-status.md` | all | tracked |
| `prd.md` | `01-product.md` | 1 — the house PRD plus the announcement paragraph and the screens line | tracked |
| `mockups/<screen>.html` | `mockups/` | 1 — one plain HTML file per screen, reviewed with `kinas open` | tracked |
| `architecture.md` | `02-architecture.md` | 2 — only when more than one layer is touched | private |
| `build-spec.md` | `03-program-design.md` **and** `04-slices.md` | 3 (§11 Program design) and 4 (§12 the slice plan) | private |

Templates are in `tasks/_templates/`. Private files stay on the captain's Mac (`.gitignore` says which, and
`scripts/gitignore.test.ts` pins it), so a build worktree holds only the tracked ones: read a private document
at its absolute path in the main checkout, which `git worktree list` names first.

## Pointers

- `DESIGN.md` is the law for every surface and `keymap.md` for every key: a component or a binding is
  written there before the code.
- `docs/adr/` holds the decisions that outlive a feature. When a gate produces one, offer to record it. A
  record is never rewritten; a changed decision is a new record that supersedes the old one by number
  (`docs/adr/adr.test.ts` enforces it).
- `docs/external/` is the map of the world outside the repository — names, paths and scopes, never values.
- The repository is public. Nothing from the git-ignored `scripts/private-names` may appear in a commit, a
  commit message or a document; `scripts/acceptance.sh` (AC-10) checks the tree.
- Build in a worktree from `origin/main`. Never switch branches, pull, stash or commit in the main checkout
  while a worktree exists.
- `bun run check` green before a PR; the e2e suite runs alone, never beside a cargo build or another
  session's e2e run.
