# Status: Folder views — hide, add and remove client folders; the sidebar's shape

- Gate 1 · Product: APPROVED 2026-09-23 — `prd.md`, from the captain's answers 1A, 2B, 3B, 4A, 5A and "build this on a new branch"
- Gates 2–4: taken as given by the same word (AGENTS.md, "anything the captain says to just do") — `prd.md` §2 and §4 are the architecture and the program design, the slices below are the plan

## Slices
- [x] Slice 0 · the docs first: DESIGN.md §3.1, §4 catalogue (Menu), the reader-header note; keymap.md; README.md; docs/smoke-test.md (2026-09-23, `420b2a8`; the Menu catalogue row landed with its story in slice 2). Before it, `9edd1c7`: `packages/context/src/config.test.ts` read the real app's store, and the captain's saved projects folder broke three cases — the test now gets an empty data folder
- [x] Slice 1 · the sidebar's shape: the Reader row gone, Settings at the foot, Recent under Client folders; shell.e2e and the Nav story follow (2026-09-23, `aafb211`): check green, shell.e2e 6/6 alone
- [x] Slice 2 · `ui/Menu`: the reader's ▾ menu moved into the library, with a divider and a story; the reader passes `reader-menu` (2026-09-23, `7947733`): check green; reader-export 5/5, reader-pins-a 6/6, stories 2/2 alone; reader-panel 3/4 on a load of 13 (AC-3's first `terminalFocused` after a cold `kinas open`), 4/4 on the same binary at once after — watch it in the full run
- [x] Slice 3 · Rust: `projects.rs` — hidden/removed/added by path, `set_folder_hidden`, `set_folder_removed`, `add_client_folder`, unit tests (2026-09-23, `bb5809e`): 187 Rust tests (6 new), clippy clean. The e2e seam is `KINAS_E2E_PICK_FOLDER`, a file holding the pick (empty = Cancel)
- [x] Slice 4 · the webview: the listing's flags, `shownFolders`, the sidebar's right-click menu, Home, Settings → Client folders (2026-09-23, `0ef2d09`): check green (558 Bun tests), home 4/4 and folders 6/6 alone; shell 3/6 once (one ⌘1 lost, the rest its cascade), 6/6 on the same binary at once after
- [x] Slice 5 · `folders.e2e.ts`, the full e2e suite alone, the screens re-taken → ship point (2026-09-23, `4728ff3` and the commit that ticks this): **full e2e alone 21/21, 120 cases, 14:26–15:09**, no sibling build or test app during it (a load log every 30 s); page contracts held, `docs/design/screens/{home,usage,settings}-*.png` re-taken; the right-click menu and the Client folders card read by eye in both themes from a throwaway spec (not committed). Commits local, **waiting for the captain's word on the push**

## Notes for a fresh session

- The PR description is drafted (not in the repo): what changed per slice, what was verified, what needs eyes. Push, open the PR and fast-forward `main` only on the captain's word.

- Built in the worktree at `.claude/worktrees/design-system` (the design-system build's, reused: its `target/` and `node_modules` are warm; auto mode refused removing it). Branch `feat/folder-views` from `main` at `ef13b12`.
- The main checkout is still at `73c70fd` with the design-system `prd.md`/`status.md` untracked there (identical to `main`'s): never pull, commit or stash there while a worktree exists.
- **Nothing is pushed without the captain's word** (2026-09-22).
- The rules that do not bend: nothing above `<Terminal>` becomes conditional, wrapped or re-keyed; every pid assertion stays green; components use tokens only; every key change in `keymap.md` first; the repository is public (private-names check over every added line, message and file name).
