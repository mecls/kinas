# TUI smoke test — the Work page's acceptance criterion

PRD §5.9. The terminal pane is the only terminal the plan endorses, so a release that fails a line here
does not ship. Run it side by side with Ghostty, before calling Build 1 done and on every dependency bump
(Tauri, xterm.js, `portable-pty`). Any visible difference fails, unless it is written below and accepted.

Each line is marked with how it was proven:

- `automated (spec)` — covered by the e2e suite (`bun run e2e`); the spec file is named
- `passed by agent` — run by the build agent, with the evidence noted
- `outstanding — needs Miguel` — needs eyes on the screen, a physical keypress or a person

The build agent cannot see the screen (no screen-recording permission) and cannot press physical keys, so
every visual line and every real-keyboard line is Miguel's.

**Versions under test:** Tauri 2.11.5 · xterm.js 6.0.0 · @xterm/addon-webgl 0.19.0 · portable-pty 0.9.0 ·
Herdr 0.9.0 · macOS 26 · 2026-09-14.

## Herdr

- [x] The pane attaches a Herdr session and runs it — `automated (herdr-keys.e2e.ts)` in a throwaway session
- [ ] Attach `default` in the pane — `outstanding — needs Miguel`
- [x] ⌃Tab and ⌃⇧Tab cycle panes — `automated (herdr-keys.e2e.ts)`: a real keydown on xterm's textarea, Kinas
      sends `\x1b[9;5u` / `\x1b[9;6u`, Herdr's focused pane changes. In `default` this also needs Miguel's
      `[keys]` fix (PRD §7 Q3), because his current `[keybindings]` section is ignored by Herdr 0.9.0.
- [ ] ⌃Tab with a physical keyboard — `outstanding — needs Miguel`
- [ ] Create and close a pane — `outstanding — needs Miguel`
- [ ] Resize the Kinas window → Herdr reflows, no leftover characters — `outstanding — needs Miguel`
- [ ] Detach → a working zsh prompt — `outstanding — needs Miguel`

## Pi

- [ ] Start `pi`; Tab completes — `outstanding — needs Miguel`
- [ ] Esc interrupts a response — `outstanding — needs Miguel`
- [ ] Multi-line input works — `outstanding — needs Miguel`
- [ ] A long, coloured response scrolls with no torn lines — `outstanding — needs Miguel`

## lazygit

- [ ] In `apps/kinas`: Tab and arrows move between panels — `outstanding — needs Miguel`
- [ ] Space stages a file — `outstanding — needs Miguel`
- [ ] Commit dialog accepts ⌘V paste — `outstanding — needs Miguel`
- [ ] Borders unbroken; mouse clicks select panels — `outstanding — needs Miguel`

## Characters

- [x] `┌─┐ ção ✓` arrive intact through the PTY into the terminal buffer — `automated (pane.e2e.ts)`
- [ ] `printf '┌─┐│└─┘ ção ✓ 🎛️ \e[38;2;0;84;158mRGB\e[0m\n'` renders the same as in Ghostty —
      `outstanding — needs Miguel`

## Keyboard contract

- [x] `cat -t`, then Tab → `^I`, focus stays in the terminal — `automated (keyboard.e2e.ts)`
- [x] ⌃C stops `sleep 100` — `automated (keyboard.e2e.ts)`, ⌃C sent as a real keydown on xterm's textarea
- [x] ⌘K raises the palette instead of reaching the shell — `automated (keyboard.e2e.ts)`
- [x] ⌘K opens the palette; Esc closes it; the next line reaches the shell — `automated (palette.e2e.ts)`
- [x] ⌘1 / ⌘2 switch pages from inside the terminal — `automated (keyboard.e2e.ts)`
- [ ] The same with a physical keyboard — `outstanding — needs Miguel`

## Throughput, page switch, renderer

- [ ] `yes | head -n 2000000` completes and ⌘K still opens the palette while it runs —
      `outstanding — needs Miguel`
- [x] Usage and back, and a hidden window: scrollback intact, shell PID unchanged — `automated (pane.e2e.ts)`
- [x] Child exit shows `[process exited — press Enter to restart]`; Enter respawns — `automated (pane.e2e.ts)`
- [x] WebGL gone → DOM renderer plus a notice, not a blank pane — `automated (pane.e2e.ts)`

## Found in daily use

Write annoyances here as they happen (task 3.9).

## Accepted differences from Ghostty

- Font: Kinas uses SF Mono; Ghostty's default is JetBrains Mono.

## Notes from building the e2e suite

- WebDriver's key actions in the embedded WKWebView driver double printable characters and send Control as a
  separate keydown without `ctrlKey`, so the suite types text through xterm's own `input()` and sends ⌃-chords
  as real keydown events on xterm's textarea. Tab, Enter and ⌘-chords go through WebDriver unchanged.
