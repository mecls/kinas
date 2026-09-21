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
- [x] ⌘1 / ⌘2 switch pages from inside the terminal — `automated (keyboard.e2e.ts)`
- [x] ⌘S hides and shows the sidebar from inside the terminal; the next line reaches the shell —
      `automated (keyboard.e2e.ts)`
- [x] A shortcut rebound in Settings (⌘B for the sidebar) works, its old chord does nothing, and a chord that is
      already taken is refused with whose it is — `automated (settings.e2e.ts)`
- [ ] The sidebar (220 px since 2026-09-18: an icon and a name for Usage and Work, Settings at the foot), the gear
      and the Settings page look right; at the window's minimum width, 820 px, the page and the reader each still
      have their 280 px — `outstanding — needs Miguel`
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
- [x] A relative link lands on its fragment and Back returns to the same scroll position —
      `automated (reader.e2e.ts, AC-3)`
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
- [x] Release build: the median of the warm opens of `fixtures/reader/plan-300.md` is under 200 ms — **median 27 ms**
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

- Font: Kinas uses SF Mono; Ghostty's default is JetBrains Mono.

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
