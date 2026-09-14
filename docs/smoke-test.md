# TUI smoke test — the Work page's acceptance criterion

PRD §5.9. The terminal pane is the only terminal the plan endorses, so a release that fails a line here
does not ship. Run it side by side with Ghostty, before calling Build 1 done and on every dependency bump
(Tauri, xterm.js, `portable-pty`). Any visible difference fails, unless it is written below and accepted.

Each line is marked with how it was proven:

- `automated (AC-n)` — covered by the e2e suite (`bun run e2e`); see the build spec's §13
- `passed by agent` — run by hand by the build agent, with the evidence noted
- `outstanding — needs Miguel` — needs eyes on the screen, a real keypress or a person

**Versions under test:** Tauri 2.11.5 · xterm.js 6.0.0 · @xterm/addon-webgl 0.19.0 · portable-pty 0.9.0 ·
Herdr 0.9.0 · macOS 26.

## Herdr

- [ ] Attach `default` in the pane — `outstanding — needs Miguel`
- [ ] ⌃Tab and ⌃⇧Tab cycle panes — `automated (AC-7)` in a throwaway session with a correct binding;
      in `default` it also needs Miguel's `[keys]` fix (PRD §7 Q3)
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

- [ ] `printf '┌─┐│└─┘ ção ✓ 🎛️ \e[38;2;0;84;158mRGB\e[0m\n'` renders the same as in Ghostty —
      bytes arrive intact: `automated (AC-8)`; the rendering itself: `outstanding — needs Miguel`

## Keyboard contract

- [ ] `cat -v`, then Tab → `^I`, focus stays in the pane — `automated (AC-7)`
- [ ] ⌃C stops `sleep 100` — `automated (AC-7)`
- [ ] ⌘K opens the palette; Esc closes it; the next keystroke reaches the shell — `automated (AC-7)`
- [ ] The same three with a real keyboard — `outstanding — needs Miguel`

## Throughput, page switch, renderer

- [ ] `yes | head -n 2000000` completes and ⌘K still opens the palette while it runs —
      `outstanding — needs Miguel`
- [ ] Usage and back: scrollback intact, shell PID unchanged — `automated (AC-8)`
- [ ] WebGL forced off → DOM renderer plus a notice, not a blank pane — `automated (AC-8)`

## Found in daily use

Write annoyances here as they happen (task 3.9).

## Accepted differences from Ghostty

- Font: Kinas uses SF Mono; Ghostty's default is JetBrains Mono.
