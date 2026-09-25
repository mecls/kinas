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
- [ ] The Work page opens on the Kinas launch screen, logo and banner intact — `outstanding — needs Miguel`
      (the key handling is `automated (hold.terminal.test.ts)` on a real terminal; the pane command is covered by
      `pty.rs` tests)
- [ ] On the launch screen, Enter attaches `default`; q leaves a working zsh prompt, and `herdr` attaches later
      — `outstanding — needs Miguel`
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
- [x] ⌘1 / ⌘2 switch pages from inside the terminal — `automated (keyboard.e2e.ts)` (since 2026-09-22 ⌘1 is Home and
      ⌘4 is Usage; the spec follows)
- [x] ⌘S hides and shows the sidebar from inside the terminal; the next line reaches the shell —
      `automated (keyboard.e2e.ts)`
- [x] A shortcut rebound in Settings (⌘B for the sidebar) works, its old chord does nothing, and a chord that is
      already taken is refused with whose it is — `automated (settings.e2e.ts)`
- [ ] The sidebar (220 px since 2026-09-18; since 2026-09-22 the wordmark, Home · Work · Crew · Inbox · Usage ·
      Reader · Settings, the client folders with their chips, the VPS row at the foot) and the Settings page look
      right; at the window's minimum width, 820 px, the page and the reader each still have their 280 px —
      `outstanding — needs Miguel`
- [ ] The same with a physical keyboard — `outstanding — needs Miguel`

## Selection and clipboard

Copies reach the macOS clipboard inside and outside Herdr, and ⌫ removes a selection at a plain shell prompt
(`tasks/prd-selection-clipboard.md`).

- [x] An OSC 52 write reaches the clipboard: `printf '\e]52;c;%s\a' "$(printf 'ção ✓' | base64)"` → `pbpaste`
      prints `ção ✓` — `automated (selection.e2e.ts)`
- [x] An OSC 52 query (`printf '\e]52;c;?\a'`) leaves the clipboard unchanged and types nothing at the prompt —
      `automated (selection.e2e.ts)`
- [x] Type `clmefes`, select `cl`, ⌫ → the line reads `mefes` — `automated (selection.e2e.ts)`, ⌫ sent as a
      real keydown on xterm's textarea
- [x] ⌫ over a selection in `less` is an ordinary ⌫ — `automated (selection.e2e.ts)`
- [x] A mouse selection is copied when the button is released — `automated (selection.e2e.ts)`, driven by DOM
      mouse events. WebDriver drags reach the page but make no selection, so the physical drag below is the only
      proof that the OS mouse works
- [x] Copying a mouse selection, or ⌘C over a selection, shows "copied to clipboard" at the bottom right of the pane
      for 1.5 s; an OSC 52 write shows nothing, because Herdr shows its own — `automated (selection.e2e.ts)`
- [ ] The toast looks right: gold border and dot on the dark ground, bottom right, gone after about 1.5 s, and a click
      on it reaches the terminal — `outstanding — needs Miguel`
- [ ] Plain zsh: drag over `mefes` → ⌘V in Notes pastes `mefes`; ⌫ removes it from the prompt —
      `outstanding — needs Miguel`
- [ ] Plain zsh: double-click a word in earlier output → it copies; ⌫ at the prompt deletes one character, as
      usual — `outstanding — needs Miguel`
- [ ] Herdr, in a Claude Code pane: drag over part of a response → ⌘V in Notes pastes it —
      `outstanding — needs Miguel`
- [ ] lazygit inside Herdr: mouse clicks still select panels (the lazygit line above still passes) —
      `outstanding — needs Miguel`

## Reader

`kinas open` and the reader (`tasks/prd-kinas-open.md`, build spec AC-1 to AC-8). Since 2026-09-18 the reader is the
panel on the **right** of the window, beside whichever page is showing (`tasks/three-column-shell-build-spec.md`).

- [x] `kinas open plan-300.md` opens the reader on the right with the frontmatter card, the diagram, the image and
      Contents, the terminal keeps focus and its PTY — `automated (reader.e2e.ts, AC-1)`
- [x] Run from the **Usage** page, `kinas open` opens the panel beside it and **does not switch to Work**; the
      panel ends at the stage's right edge and the PTY is the same process — `automated (reader.e2e.ts)`
- [ ] Dragging the divider resizes the reader against the terminal, the terminal refits, the width survives a
      relaunch, and double-click restores 45 % (55 % until the sidebar grew to 220 px, 2026-09-18) —
      `automated (reader.e2e.ts)`; the drag by hand with a real mouse is
      `outstanding — needs Miguel`
- [x] A relative link lands on its fragment and Back returns to the same scroll position (the title bar's ← since
      2026-09-24, the reader's layout) — `automated (reader.e2e.ts, AC-3)`
- [x] An append is on screen in under 1 s without redrawing the diagram; a growing file stays at the bottom; a
      rename over the file and a removal are followed — `automated (reader.e2e.ts, AC-2)`
- [x] `kinas open fixtures/reader/binary.bin` → 65 with one line (`~/.zshrc` used to be the 65 case and now opens:
      it is text); `/tmp/x.md` → 77 with one line; a symlink out of the root → 77; a missing file → 66 and nothing
      is created — `automated (reader.e2e.ts, AC-4; cli/src/open.test.ts)`
- [x] `kinas open 0008_funnel_stage.sql` from an unrelated folder opens it as source: `data-render="source"`, the
      code element carries `language-sql`, and no Contents rail appears because source has no headings. A plain
      `.txt` opens the same way with no language class — `automated (reader.e2e.ts)`, and both confirmed on the
      installed build 2026-09-16 (`.sql` exit 0, `binary.bin` exit 65)
- [x] Code is highlighted, lines are numbered, and neither reaches a copy: the `.sql` fixture shows
      `.hljs-keyword`, the gutter holds exactly one number per line of code, and selecting the whole source block
      copies the code with **no digits**; a fence-free markdown file loads **no** highlighter chunk —
      `automated (reader.e2e.ts)`. The first highlighted open (`kinas open` → socket → read → render → highlight,
      including the grammar's chunk) took **65 ms** on 2026-09-17, and 338 ms on the run before it — debug e2e
      builds, so the spread is the machine's; AC-7's median warm open on the signed build is the number that gates
      a release. Vite emits **one chunk per grammar**: core 20,403 B plus 586 B (`json`) to 7,608 B
      (`typescript`), so a first highlight pulls **~26 KB**, not the 5.50 MB whole-package figure
- [x] An `.html` file opens as the page it is, in an `<iframe sandbox="allow-scripts">` with an injected
      `default-src 'none'` policy; its inline script runs (reported by `postMessage` to a debug-only listener),
      the **Rendered / Source** toggle shows the markup escaped and back, and a save reassigns `srcdoc` on the **same**
      element — proven by marking the node, since a replacement would restart the page *and* jump the layout —
      `automated (reader.e2e.ts)`
- [x] **Nothing in a previewed page reaches the network or the app**, observed on a real socket rather than
      inferred: `fixtures/reader/hostile.html` aims 14 URLs at a local listener (`fetch`, `XHR`, `WebSocket`,
      `sendBeacon`, `<img>`, `<link>`, `<script src>`, `<iframe>`, `<object>`, `new Worker`, an auto-submitting
      form, a `<base href>`-retargeted relative fetch) and carries its own `default-src *` CSP — the log records
      **0 requests**, `window.__pwned` is undefined, the URL and title are unchanged, and the app still answers
      after the fixture's `alert` loop. Checked on both the probe's frame and the reader's own UI path —
      `automated (reader.e2e.ts)`. The benign `preview.html` is what stops this passing against a preview that
      renders nothing
- [x] The file tree lists every openable file plus images and omits binaries; an empty folder reads `Nothing to
      open in <folder>` — `automated (reader.e2e.ts; mod.rs list_dir tests)`
- [x] `--anywhere` shows the card, Enter in the terminal does not accept it, Open does —
      `automated (reader.e2e.ts, AC-5)`
- [x] Script, `onerror`, `javascript:` links and remote images in a file do nothing — `automated (reader.e2e.ts, AC-6)`
- [x] Open in editor splits the focused Herdr pane with the editor on the file; with no Herdr it says so —
      `automated (reader-editor.e2e.ts, AC-7)`, in the throwaway session `kinas-e2e-editor`
- [x] Release build: the median of the warm opens of `fixtures/reader/plan-300.md` is under 200 ms — **median 46 ms**
      over 5 warm opens (36, 55, 46, 29, 97) on the design-system build installed 2026-09-23 (PR #24), the cold first
      read 303 ms and excluded, another session loading the Mac (load 31 as it began) — `passed by agent`. Earlier:
      **median 27 ms**
      over 5 warm opens (60, 28, 26, 26, 27) on the build from `6fc9bbe`, the cold first read 483 ms and excluded,
      with `other.md` steady at 20–21 ms and `read in 0 ms, watch in 0 ms` throughout — `passed by agent`
      2026-09-17, with the highlighter and the HTML preview in the build. (Previously **median 30 ms** over
      (41, 35, 30, 28, 29) on `96892b0`, 2026-09-16 — so highlighting and the preview cost nothing measurable.)
      **The installed bundle must be ad-hoc signed**
      (`codesign --force --deep --sign - /Applications/Kinas.app`): unsigned, a freshly copied bundle's first file
      read is held by macOS for minutes. **Wait the cold read out and measure only warm opens.** It has run 1 s,
      19 s, 21 s and 82 s across installs, growing when the same bundle is re-copied and re-signed, because macOS
      assesses the new code. The window stays usable while it happens, since reads are off the main thread
      (PRD R9, amended); the median above is what an open costs in use
- [x] **Measure from a log this run owns.** Empty `~/Library/Logs/ai.sintralabs.kinas/kinas.log` immediately before
      the first open, and count matching lines — never line offsets (the logger discards the file when it outgrows
      its cap) and never timestamps (the app stamps UTC, `date` prints local: an hour apart here). An install
      failed for a fourth reason on 2026-09-16 — the baseline already held ten `plan-300` renders from the e2e, so
      the count could not grow past it and the gate read that as "never rendered", while the same bundle run in
      place rendered in 1332 ms. Keep the CLI's exit code and stderr too: discarding them cost a whole diagnosis
      cycle, because nothing distinguished "the request never arrived" from "it arrived and hung"
- [x] **Download** writes a byte-for-byte copy where the save sheet said, through a temp file that is gone
      afterwards; the log gains `reader: exported <N> bytes in <M> ms` and never the name or the folder; a name
      taken by a folder is refused in Rust's own words and the folder is left as it was —
      `automated (reader-export.e2e.ts, through the debug-only KINAS_E2E_EXPORT_TO seam)`. The refusals — the file
      itself by path, through a symlinked folder, as a symlink, as a hard link; a symlink, a dangling symlink or a
      folder at the name; Kinas' own data, logs and app, however reached; a source past the limit; an unwritable
      folder — each leave the source's bytes and mtime alone and no temp file behind —
      `automated (reader/export.rs, 12 tests over real files)`
- [x] **The webview cannot raise a dialog of its own**: `plugin:dialog|save`, `|open`, `|message`, `|ask` and
      `|confirm` invoked from the page are all rejected, because no capability grants a `dialog:*` permission —
      `automated (reader-export.e2e.ts)`
- [ ] **The save sheet itself**, on the installed app — no agent can click it: it slides from the Kinas title bar
      (not a free-floating panel); the name field holds the file's name and the folder is Downloads; Save → the
      file is there, `cmp` says identical, the status line says `Saved <name>`; Cancel → no file and no message;
      choosing the open file itself → `That is this file — choose another place`, original intact; the terminal
      keeps updating behind the sheet — `outstanding — needs Miguel`
- [x] **Print as PDF prints the document, only the document, across pages** — proved on WebKit through the same
      `printOperation(with:)` call the app's print button reaches, with the panel suppressed
      (`bun scripts/print-probe.ts`): without `print.css` **1 page** and the chrome leaks, so the probe sees the
      failure; with it markdown **6 pages**, source **17**, last line present, nothing leaked, and `@page` margins
      hold with the print-info margins at 0 — `passed by agent` 2026-09-18. In the app, Print reaches Rust, and is
      off with a reason for an image and for an `.html` page in its rendered view —
      `automated (reader-export.e2e.ts, KINAS_E2E_NO_PRINT seam)`; the palette holds 4.5:1 on white —
      `automated (styles/print.test.ts)`
- [ ] **The print sheet itself**, on the installed app: it attaches to the window and `yes | head -n 200000` keeps
      scrolling behind it; ≥ 5 pages with the last heading; no sidebar, terminal or header, dark text on white;
      margins on page 2 onward; the default PDF name (probably "Kinas" — wry sets no job title); after Cancel
      **and** after Save the terminal's size, the reader's scroll position and focus are unchanged; a Mermaid
      diagram and a code block are legible on white; images print; a second print works —
      `outstanding — needs Miguel`
- [ ] Edit a plan in vim in a Herdr pane beside the reader and save three times: the page updates each time with
      no blank frame and no diagram flash — `outstanding — needs Miguel`
- [ ] Open in editor from a plan in your own `default` session opens vim in a new pane beside the focused one —
      `outstanding — needs Miguel`
- [x] The file tree lives in the **left sidebar** while it is showing: `kinas open docs` lists the folder there with
      README.md selected, a click on another file opens it and **keeps the folder** (and adds no line to the log the
      200 ms gate counts), and with the sidebar hidden (⌘S) the tree comes back to the reader behind its Files
      button — `automated (reader.e2e.ts, three-column shell AC-11)`
- [x] **Pinned** survives a relaunch and **Recent** does not — proved across two real launches over one data folder:
      a file pinned from the ▾ menu and a folder pinned from its Files header are listed in order, stored as
      `{path, kind}` under the one settings key `reader_pins`, and absent from `kinas status --json` and from the
      log; a pinned folder opens as a tree; a pin whose file was deleted **stays**, greyed, titled `… is missing`,
      does nothing when clicked, and only its Unpin removes it; the 51st pin is refused in Rust's words and
      `/etc/hosts` cannot be pinned at all; after the relaunch both pins are back, the sixteen files that were
      merely opened are not, and with nothing in it the Recent section is not drawn —
      `automated (reader-pins-a.e2e.ts then reader-pins-b.e2e.ts; reader/pins.rs, 9 tests incl. a store reopen)`
- [x] **Recent** holds 15, newest first, lists a file once, and a row opens its file —
      `automated (reader-pins-a.e2e.ts; shell/recent.test.ts)`
- [ ] The sidebar's sections look right: nothing but the pages and Settings on a fresh launch; Pinned appears with
      the first pin; the pin and unpin buttons show when a row is pointed at — `outstanding — needs Miguel`
- [x] **Folders in the sidebar** (2026-09-21): a folder is pinned from a folder row inside a file tree; an opened
      folder joins **Recent** as a folder row, above the files opened before it, and a click on it reopens it in
      Files — `automated (reader-terminal.e2e.ts; shell/recent.test.ts)`
- [x] **Open in the terminal** asks Herdr for the folder's workspace and never types into the pane: the first click
      creates exactly one workspace labelled with the folder's path under the projects folder, its pane starts in
      that folder, the Work page shows and the terminal has the keys, the PTY's pid is unchanged and the pane holds
      no typed `cd`; a second click from another workspace focuses the first and creates nothing; a folder that
      has gone is refused in Rust's words, shown at the foot of the sidebar while the panel is closed; the log
      gains `reader: folder opened in the terminal (created|focused) in <N> ms` and never the folder's name —
      `automated (reader-terminal.e2e.ts)`, in the throwaway session `kinas-e2e-terminal`
- [ ] Open in the terminal in your own `default` session: point at a pinned folder, click the terminal button → a
      workspace named after it appears in Herdr and you are in it on the Work page; from another workspace, click
      again → it comes back, with no duplicate. With the launch screen still showing and Herdr's server running (it
      keeps running after any attach), the workspace is made all the same and Enter lands you in it — Herdr's
      "focused pane" is the server's, so Kinas cannot tell that its own pane is not attached; only with no server at
      all does it say `Herdr isn't running; attach it first`. The folder buttons come into the row when it is
      pointed at, so a long folder name shortens under the pointer — say if that reads badly —
      `outstanding — needs Miguel`
- [ ] Docked beside the sidebar the reader is under 640 px, so **Contents** is a header button that opens over the
      page; **Expand** it and Contents becomes a column beside the document. With the sidebar hidden, Files does
      the same — `outstanding — needs Miguel` (the button and its list are `automated (reader.e2e.ts, AC-1)`)
- [ ] Cursor not opened to read markdown since ____ (the plan's first "done when", after a week) —
      `outstanding — needs Miguel`

## Light theme

Settings → Appearance: Follow macOS, Light or Dark. One stylesheet, two grounds; the window's appearance chooses.
Amended 2026-09-22 (design system): the token names below are the old set's; from slice 1 of the design system the
same checks run over `DESIGN.md`'s tokens (`--bg`, `--surface`, `--ink`, …) with the accent as well — see the
"Design system" section below.

- [x] The two grounds are the same set of names; on warm white and on a white panel every colour that draws text
      reaches 4.5:1 and every chart series 3:1; four ANSI slots equal their tokens on both; no rule holds a colour
      literal; the light block is screen-only, so print is what `print.css` says from either —
      `automated (styles/tokens.test.ts, styles/print.test.ts)`
- [x] The CLI paints only royal blue, crimson and the logo in 24-bit; its text is the terminal's foreground,
      bright black and yellow; gold is never bold; the logo's disc is navy unless `COLORFGBG` says the ground is
      light, and then royal blue with the rim drawn in the disc's own dots —
      `automated (commands/theme.test.ts, cli/launch.test.tsx, palette/snapshotAdapter.test.ts)`
- [x] The launch screen is told the ground on its own command line, and `herdr` — which may start the server that
      outlives the app — is not, nor does it inherit one from whatever started Kinas — `automated (cargo test, pty.rs)`
- [x] Choosing Light turns the page to warm white through the **window**, not through the page: Rust sets the
      app's appearance and WebKit's `prefers-color-scheme` follows, with no attribute on `<html>`; the running
      terminal takes the new theme without a remount, and the foot of the pane, below the last whole row, is the
      ground rather than xterm's own black; Dark turns all of it back; anything but the three choices is refused
      and the stored one kept — `automated (appearance.e2e.ts)`, 6 passing, 2026-09-21
- [ ] The title bar, the native select, the checkbox and the scrollbars turn with the setting; relaunching with
      Light stored under a dark macOS shows no dark flash; with Follow macOS chosen, turning macOS's appearance
      turns the app while it runs — `outstanding — needs Miguel`
- [ ] Herdr turns live with the pane. Look at its bars and borders: on the light ground ANSI black is a surface
      and white is ink, as on the dark one — `outstanding — needs Miguel`
- [ ] A program that paints its own 24-bit dark theme does not follow the pane. Claude Code is the one that
      matters: `/theme` — `outstanding — needs Miguel`
- [ ] A launch screen already on screen keeps its logo's disc after a live switch, and its text turns; the next
      launch screen is right — `outstanding — needs Miguel`
- [ ] With a Mermaid document open, a switch redraws each diagram where it stands and the page does not jump;
      Print as PDF from each ground gives the same sheet — `outstanding — needs Miguel`
- [ ] By eye, on the light ground: how much blue the labels add; the warn fill (a bar past 80 % used, amended
      2026-09-23 — the old ≤ 25 % left rule is gone); `--line` round the text fields; the Usage chart's providers and
      its no-data hatch — `outstanding — needs Miguel`
- [ ] The HTML preview stays on white under both — `outstanding — needs Miguel`

## Design system

`DESIGN.md` is the law, `app/src/styles/tokens.css` its one implementation, `app/src/ui/` its components, and
`design/preview.html` the mockup every screen came from (2026-09-22/23, the design-system build).

- [x] `DESIGN.md` §2, `tokens.css`, the preview's token blocks and `tasks/_templates/mockup.html` hold the same values in
      both themes; §4's catalogue is the stories as built; no old token name is declared or read anywhere —
      `automated (styles/design.test.ts, styles/preview.test.ts, ui/stories.test.ts, styles/tokens.test.ts)`
- [x] No raw colour, font size or spacing outside `tokens.css` (one sheet on a ratchet: `reader.css`, the document's
      prose rhythm, 29); no background transition; every text pair at its floor in both themes and at every accent
      swatch — `automated (styles/guard.test.ts, styles/tokens.test.ts)`
- [x] Every component renders every state in both themes and holds its style contract
      (`fixtures/screens/stories.json`) — `automated (stories.e2e.ts)`; the pages hold theirs
      (`fixtures/screens/{home,usage,settings}.json`) — `automated (screens.e2e.ts)`
- [x] Home lands, lists the client folders with their chips, says nothing waits, and holds the one danger reading;
      ⌘4 and ⌘1 move between it and Usage with the PTY untouched — `automated (home.e2e.ts)`
- [x] An accent chosen in Settings is painted at once, stored, derived for the dark theme, and the PTY never notices —
      `automated (appearance.e2e.ts)`
- [ ] Home against `docs/design/screens/home-light.png` and `home-dark.png`, on your screen with your folders —
      `outstanding — needs Miguel`
- [ ] Usage against `docs/design/screens/usage-light.png` and `usage-dark.png`, scrolled through every provider —
      `outstanding — needs Miguel`
- [ ] Settings against `docs/design/screens/settings-light.png` and `settings-dark.png`, every card —
      `outstanding — needs Miguel`
- [ ] The components against `docs/design/screens/stories-{light,dark}-*.png` (a debug build, `#stories`) —
      `outstanding — needs Miguel`
- [ ] The Work page: the chrome above the pane names `default` with the working badge, Copy copies a selection, and
      the pane in your `default` session looks as it did — `outstanding — needs Miguel`
- [ ] The accent you want, and whether the six category colours suit your folders (Settings → Client folders) —
      `outstanding — needs Miguel`

## Folder views

Hide, show, add and remove client folders; the sidebar's shape (2026-09-23, `tasks/folder-views/prd.md`). The full
e2e suite ran green alone with them: 21 specs, 120 cases.

- [x] The sidebar lists Home, Work, Crew, Inbox and Usage with no Reader row, then Pinned, Files, Client folders and
      Recent in that order, with Settings as its last row under the VPS line — `automated (shell.e2e.ts)`
- [x] A right-click on a client folder offers Hide from sidebar and Add a client folder…, then Show for each hidden
      folder; a hidden folder leaves the sidebar and Home, and no other folder's colour changes —
      `automated (folders.e2e.ts; shell/folders.test.ts)`
- [x] Settings → Client folders: the In sidebar switch hides and shows, Remove moves a folder to the Removed list,
      Restore brings it back shown; nothing on disk changes — `automated (folders.e2e.ts; projects.rs)`
- [x] Add a client folder… takes any folder inside the projects folder, git or not, lists an already listed one
      once, and refuses the projects folder itself and anything outside it — `automated (folders.e2e.ts; projects.rs)`
- [ ] The right-click menu at the pointer in both themes, and no WebKit menu anywhere on a folder row; the Finder
      window opens in the projects folder and can make a new folder — `outstanding — needs Miguel`
- [ ] The folders you no longer use hidden or removed, and Settings where you want it at the foot —
      `outstanding — needs Miguel`

## Tree changes

Every file tree marks what changed since it was first shown, and the reader's Changes view diffs against that moment
(2026-09-23, `tasks/tree-changes/prd.md`). Built 2026-09-24; the steps named are `tree-changes.e2e.ts`'s.

- [x] A write, an edit and a delete under an open folder mark A, M and D within a second; a collapsed folder shows the
      strongest change's dot and the count — `automated (tree-changes.e2e.ts, steps 2–4, 2 s ceilings)`
- [x] An edit put back, and a file made then removed, leave no mark and no row — `automated (steps 5 and 6; the
      README is put back through git's blob, not a kept copy)`
- [x] A marked file opens on Changes; a deleted one shows what it said, and Copy and Download take that text —
      `automated (step 3's view, step 4's click; the real clipboard, saved and put back)`
- [x] ↻, Refresh files and a window reload clear every mark — `automated (steps 7 and 13; palette.e2e.ts for Refresh
      files with no folder)`
- [x] With git out of reach, or the watch refused, the tree still lists and says so — `automated
      (tree-changes-no-git.e2e.ts, tree-changes-watch-fail.e2e.ts)`
- [x] Nothing about changes reaches the log but counts — `automated (step 11: none of the fixture's names or text in
      what the run wrote, and every "tree changes:" line one of the count shapes)`
- [x] Median from a write on disk to its mark, over 10 writes: under 1 s — **median 100 ms** (94, 107, 93, 99, 95,
      100, 106, 102, 100, 102), stamped in the page as each mark reached the DOM, on the debug e2e build 2026-09-24
      19:52, run alone — `automated (tree-changes.e2e.ts, the timing case, which fails at 1 s)`
- [x] A folder's first paint in Files does not move (rule 29) — confirmed by eye on the installed build from `c5209fa`
      on 2026-09-25: opening folders and files feels as before. Not timed, since the app logs no paint time; the same
      build's warm open of a file was a median of 36 ms — `confirmed by Miguel, by eye`
- [ ] The Kinas repository opened in Files: its copies, their bytes and the time the baseline took, from the log's
      `tree changes: baseline taken` line. On the installed build, a folder open in Files took its baseline in 87 ms,
      45 copies, 1,829,092 bytes, and two rescans (FSEvents dropped events) judged its 454 entries in 122 and 40 ms
      (2026-09-25). The log names no folder (rule 26), so which one is not recorded — `outstanding for the Kinas
      repository itself`
- [ ] A real agent's session read by eye: marks, roll-ups, the Changes view on markdown and code, both themes —
      marks seen live on the installed build on 2026-09-25 (an amber dot and M on a file an agent was editing); the
      Changes view on code and both themes are still to look at — `in part, needs Miguel`

## The reader's layout

The side column and the text, the reader's tabs, and the window's title bar (2026-09-24,
`tasks/reader-layout/prd.md`). The e2e suite covers the rest: `reader-layout.e2e.ts`, `reader-tabs.e2e.ts` and
`title-bar.e2e.ts`; these are what only eyes can check.

- [x] The title bar moves the window when dragged anywhere but its three buttons, and a double-click on it zooms the
      window and a second one unzooms it — `checked by Miguel on the debug build, 2026-09-24`
- [x] Out of full screen, the traffic lights are centred in the bar — `checked by Miguel on the debug build, 2026-09-24`
- [x] The green light takes the window to full screen, filling it; there the three buttons sit at the bar's left
      padding and nothing sits where the traffic lights were, and leaving it puts them back beside the lights —
      `checked by Miguel on the debug build launched as a regular app, 2026-09-24`
- [ ] On the wide screen, the reader expanded and Contents hidden: long lines read comfortably, or ask for the
      reader-layout PRD's round 1 option 4C — `outstanding — needs Miguel`
- [ ] Fifteen tabs: the strip scrolls sideways with the trackpad, and dragging a tab feels right —
      `outstanding — needs Miguel`
- [ ] Both themes: the column edge's accent while dragged, the showing tab joined to the header, and a ← or → with
      nowhere to go drawn in `--ink-3` — `outstanding — needs Miguel`

## The crew: setup

`kinas crew setup` and the crew's tools (2026-09-24, `tasks/first-mate/prd.md`, slice 2).

- [ ] `kinas crew setup --dry-run` in the Work pane prints every step as `would: …` and changes nothing —
      `automated (crew-setup.test.ts)`; on this Mac — `passed by agent` once slice 2 records it
- [ ] `kinas crew setup` asks y/N before each tool, prints the `setup hooks` lines without running them, and ends with
      the table and exit 0 — `outstanding — needs Miguel` for the prompts in the pane
- [ ] Settings → Crew shows Firstmate at `f9f74a1 (pinned)`, backend `herdr`, every tool `installed`, `gh` signed in —
      `automated (crew-settings.e2e.ts)` over stub tools; on the real install — `outstanding — needs Miguel`

## The crew: launch

The first mate in the pane (2026-09-24, slice 3).

- [ ] Launch the first mate on the Crew page opens a `firstmate` workspace in the attached session, its pane in
      Firstmate's home running `claude`, and gives the terminal the keys; Claude Code asks once to trust the folder —
      `automated (crew-launch.e2e.ts)` with a stand-in in `kinas-e2e-crew`; in `default` with the real `claude` —
      `outstanding — needs Miguel`
- [ ] First mate (Crew), the palette's Go to the first mate and Home's Launch task focus that workspace and make no
      second one — `automated (crew-launch.e2e.ts)`
- [ ] Kinas started with Herdr up and a `firstmate` workspace in `default` opens the pane on it once, and never moves
      it again without a click — `automated (crew-launch.e2e.ts)`; in `default` — `outstanding — needs Miguel`
- [ ] The Work chrome reads `default · firstmate` and `claude` on the first mate's pane, `default · fm-<id>` with the
      task's badge on a worker's, and `shell` · `plain shell` without Herdr — `automated (crew-chrome.e2e.ts)`

## Throughput, page switch, renderer

- [ ] `yes | head -n 2000000` completes and ⌘K still opens the palette while it runs —
      `outstanding — needs Miguel`
- [x] Usage and back, and a hidden window: scrollback intact, shell PID unchanged — `automated (pane.e2e.ts)`
- [x] Child exit shows `[process exited — press Enter to restart]`; Enter respawns — `automated (pane.e2e.ts)`
- [x] WebGL gone → DOM renderer plus a notice, not a blank pane — `automated (pane.e2e.ts)`

## Build 1 validation

Checks from PRD §5, run on this Mac against `/Applications/Kinas.app` and its real store
(`scripts/acceptance.sh` runs the repeatable ones).

- **5.1 Repo greps** (2026-09-14, `build-1`): `scripts/acceptance.sh ac10` — both PRD §5.1 `git grep`s print
  nothing outside `tasks/` and the script itself (which names the patterns; this file deliberately doesn't), and
  `strings Kinas.app/Contents/MacOS/Kinas | grep -c -E 'wdio|__kinasTest'` → 0.
- **5.2 Store shape** (2026-09-14): `PRAGMA journal_mode` → `wal`; tables without `org_id NOT NULL` → 0 rows;
  `SELECT count(*) FROM orgs` → 1; `schema_migrations` → 1.
- **5.3 No secrets at rest** — early run, 2026-09-14, minutes after the Ollama key was saved (the hour of use is
  still to come): the key's first 12 characters, `sk-ant-` and `Bearer` → 0 in `kinas.sqlite`, `-wal`, `-shm` and
  `kinas.log`; `kinas status --json | grep -c -E 'sk-ant-|Bearer'` → 0.
- **5.5 Ollama against ollama.com**, first half (2026-09-14 19:09): ollama.com showed session 2 % used and weekly
  0.4 % used; the store held `used_pct` 2.0 and 0.4, and the gauges read 98 % and 99 % left (floored). Removing the
  key and checking for zero requests is still to do.
- **5.7 Recount** (2026-09-14): `scripts/check-usage.ts` on 2026-09-11, -12 and -13 — 7 date·harness·model rows,
  Claude Code and Pi, all equal.
- **5.8 Idempotency**: relaunch → past totals unchanged. `DELETE FROM log_cursors` + relaunch **failed** on the
  first build: the six days older than the 45-day `usage_seen` cutoff doubled exactly. Fixed by never pruning
  `usage_seen` (PRD R26 amended). Re-run on the fixed build (2026-09-14, after rebuilding the usage tables from
  the transcripts): `check-usage.ts` over all 34 past dates → all rows match; relaunch → 58 past rows unchanged;
  `DELETE FROM log_cursors` + relaunch → unchanged. **Passes.**
- **5.11 Host numbers** (2026-09-14): memory 16 GiB vs `hw.memsize` 16.0; disk free 17.14 GiB vs `df` 17.14 GiB;
  CPU 90.7 % after 9 s of `yes` on every core.
  Re-run 2026-09-15 after the Disk tile moved to Finder's number:
  - disk available 33.32306 GiB vs NSURL's `VolumeAvailableCapacityForImportantUsage`, read through JXA,
    33.32302 GiB
  - disk free 25.31 GiB vs `df`'s 25.31 GiB
  - CPU 99 % after 15 s
- **5.12 Done-when clock**: starts the first workday Miguel uses Kinas.app as his terminal.

## Found in daily use

Write annoyances here as they happen (task 3.9).

## Accepted differences from Ghostty

- Font: Kinas used SF Mono until 2026-09-22; since the design system it bundles JetBrains Mono (`--font-mono`), the
  same family as Ghostty's default, at 13 px.
- Since the light theme (2026-09-21), the `kinas` CLI's secondary text and its banner's shadow are ANSI bright
  black, not a fixed `#8593A6`. In the dark pane that is `#8A8F98` (`--muted`): a shade less blue, 5.99:1 on the
  ground where it was 6.23:1. In Ghostty it is Ghostty's bright black.

## Notes from building the e2e suite

- WebDriver's key actions in the embedded WKWebView driver double printable characters and send Control as a
  separate keydown without `ctrlKey`, so the suite types text through xterm's own `input()` and sends ⌃-chords
  as real keydown events on xterm's textarea. Tab, Enter and ⌘-chords go through WebDriver unchanged.
- **Only element lookups are slow, not every command.** `@wdio/tauri-service` runs `ensureActiveWindowFocus` in
  `beforeCommand`, and it returns immediately unless the command is `getTitle`, `findElement`, `findElements`,
  `$`, `$$` or `elementClick`; only those wait up to 5 s for the app's invoke bridge. `browser.execute` never pays
  it, which is why conditions are polled **in the page** (`waitInPage`) rather than with a selector.
- **Run the reader spec alone, and re-run before believing a regression.** On 2026-09-17 the same commit gave
  11 passing with AC-3 hitting mocha's 120 s timeout in **15m 54.8s** when run straight after `bun run check`
  (cargo build + clippy), then **12 passing in 3m 37s** run alone. The invoke-timeout warnings are a red herring:
  35 on the fast run, 4 on the slow one.
- **`bun e2e/run.ts` needs `bun` and `cargo` on PATH and says nothing when they are missing.** `run.ts:30–34`
  spawns bare `bun`, takes `build.status ?? 1` and exits before printing, so an ENOENT looks like an instant
  total failure with zero output. Run it as `PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" bun e2e/run.ts reader`.
