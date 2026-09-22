# Status: The design system — rebuild the Kinas UI to the design preview

- Gate 1 · Product: APPROVED 2026-09-22
  - Mockups: APPROVED 2026-09-22 — `design/preview.html` is the mockup for every screen in this pass (the Mac window: Home, the sidebar, the right panel; the component catalogue is the reference for Usage and Settings)
- Gate 2 · Architecture: APPROVED 2026-09-22
- Gate 3 · Program design: APPROVED 2026-09-22
- Gate 4 · Slice plan: APPROVED 2026-09-22

## Slices
- [x] Slice 0 · ship PR #22 (the light theme), the worktree, the documents, Gates 2–4, the docs-first amendments — 2026-09-22
- [x] Slice 1 · tracer bullet (2026-09-22, `5bd6d5d`): `tokens.css` ported, fonts bundled, the accent setting; the app runs on the new tokens with nothing else restyled
- [x] Slice 2 · the primitives in `app/src/ui/` with stories, the guard test (2026-09-22, `f838593`) → ship point 1: full e2e green alone 2026-09-22 (18/18; `reader-export` once on a loaded Mac, then 5/5 alone); **waiting for the captain's word on the push** — nothing pushed
- [x] Slice 3 · the shell: sidebar, nav, title row, client folders, connection row, `go.home` (2026-09-22, committed locally): `bun run check` green; every touched spec green alone; the reader panel moved onto `--surface` at the captain's report (an open file had the terminal's background) — nothing pushed
- [ ] Slice 4 · Usage on the primitives → ship point 2
- [ ] Slice 5 · Home
- [ ] Slice 6 · Settings cards, the reader header, palette and toasts, the terminal chrome, the alias block removed
- [ ] Slice 7 · DESIGN.md finished, the preview updated, screenshots, the smoke test → ship point 3

## Notes for a fresh session

- **Read `build-spec.md` first** (private — `.gitignore` tracks only this file, `prd.md` and `mockups/`; read it at its absolute path in the main checkout, which `git worktree list` names first). Its §17 is the decisions log; §11 is the program design (Gate 3); §12 is the slice plan (Gate 4). `architecture.md` (private, beside it) is Gate 2.
- The mockup is `design/preview.html` in the repo (the copy in `~/Downloads/kinas-design-preview.html` still carries a client name in two demo-data lines and must never be committed). `DESIGN.md` is the law; where the preview and DESIGN.md differ, DESIGN.md is amended with a dated note first (Changes → 1.2), then followed.
- Decided with the captain on 2026-09-22: PR #22 (`feat/light-theme`) ships first and its theme mechanism stays (Rust sets the window theme; `prefers-color-scheme`; **no `data-theme` attribute**); the terminal follows the theme (DESIGN.md §2.3 amended); client folders are the git repositories the context packet discovers, category colour by name hash, an "internal" flag per folder in Settings; the preview stays at `design/preview.html`.
- Defaults the captain may veto (build-spec §17): Bricolage Grotesque as the display face (Clash Display's license forbids redistribution); `--fs-*`/`--lh-*` type tokens; `--space-0`/`--space-1h`; Home as the landing page now (⌘1 Home, ⌘4 Usage, ⌘3 reserved for Crew); Crew/Inbox/Reader nav click-only, the palette gains only `go.home`; gauge thresholds 80/95 % used; the guard test ratchets `reader.css`.
- **Nothing is pushed without the captain's word** (2026-09-22): no branch push, no PR, no fast-forward until he says "push"; commits stay local.
- The rules that do not bend: nothing above `<Terminal>` becomes conditional, wrapped or re-keyed; every pid assertion stays green; components use tokens only; pages compose and add layout; every key change in `keymap.md` first; no styling dependency, no icon library, no network at runtime; the repository is public.
