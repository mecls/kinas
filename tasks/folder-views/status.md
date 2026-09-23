# Status: Folder views — hide, add and remove client folders; the sidebar's shape

- Gate 1 · Product: APPROVED 2026-09-23 — `prd.md`, from the captain's answers 1A, 2B, 3B, 4A, 5A and "build this on a new branch"
- Gates 2–4: taken as given by the same word (AGENTS.md, "anything the captain says to just do") — `prd.md` §2 and §4 are the architecture and the program design, the slices below are the plan

## Slices
- [ ] Slice 0 · the docs first: DESIGN.md §3.1, §4 catalogue (Menu), the reader-header note; keymap.md; README.md; docs/smoke-test.md
- [ ] Slice 1 · the sidebar's shape: the Reader row gone, Settings at the foot, Recent under Client folders; shell.e2e and the Nav story follow
- [ ] Slice 2 · `ui/Menu`: the reader's ▾ menu moved into the library, with a divider and a story; the reader passes `reader-menu`
- [ ] Slice 3 · Rust: `projects.rs` — hidden/removed/added by path, `set_folder_hidden`, `set_folder_removed`, `add_client_folder`, unit tests
- [ ] Slice 4 · the webview: the listing's flags, `shownFolders`, the sidebar's right-click menu, Home, Settings → Client folders
- [ ] Slice 5 · `folders.e2e.ts`, the full e2e suite alone, the screens re-taken → ship point: commits local, **waiting for the captain's word on the push**

## Notes for a fresh session

- Built in the worktree at `.claude/worktrees/design-system` (the design-system build's, reused: its `target/` and `node_modules` are warm; auto mode refused removing it). Branch `feat/folder-views` from `main` at `ef13b12`.
- The main checkout is still at `73c70fd` with the design-system `prd.md`/`status.md` untracked there (identical to `main`'s): never pull, commit or stash there while a worktree exists.
- **Nothing is pushed without the captain's word** (2026-09-22).
- The rules that do not bend: nothing above `<Terminal>` becomes conditional, wrapped or re-keyed; every pid assertion stays green; components use tokens only; every key change in `keymap.md` first; the repository is public (private-names check over every added line, message and file name).
