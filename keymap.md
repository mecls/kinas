# Kinas keymap

Every key binding in Kinas, on every surface. A binding is added here **before** the code that
registers it (PRD rule 5). A binding in code that is not listed here is a bug.

## Global (system-wide)

| Chord | Action | Notes |
|---|---|---|
| ⌘⇧Space | Bring Kinas forward and open the palette | Configurable in Settings. Must always contain ⌘ (R30): ⌘ chords never produce terminal input, so the pane contract holds while it is registered. Never ⌘K, never an in-window shortcut or a macOS menu chord. If registration fails, Settings shows "hotkey unavailable" and no other chord is registered. |

## In the Kinas window

| Chord | Action |
|---|---|
| ⌘K | Open the command palette |
| ⌘1 | Go to the Home page (Usage until 2026-09-22, see below) |
| ⌘2 | Go to the Work page |
| ⌘3 | Go to the Crew page (from Build 3; bound to nothing until it lands) |
| ⌘4 | Go to the Usage page |
| ⌘5 | Go to the Inbox page (from Build 3; bound to nothing until it lands) |
| ⌘S | Hide or show the sidebar (remembered across launches) |
| ⌘, | Open the Settings page (also the gear at the foot of the sidebar) |
| ⌘W | Hide the window (the app, readers and terminal keep running) |
| ⌘H | Hide Kinas (macOS standard) |
| ⌘M | Minimise the window (macOS standard) |
| ⌘Q | Quit Kinas (the terminal child gets SIGHUP, then SIGKILL after 2 s) |

⌘K, ⌘1, ⌘2, ⌘4, ⌘S and ⌘, are defaults: Settings → Keyboard shortcuts rebinds them, and the terminal pane follows.
A shortcut must include ⌘ (so it never takes a key from the terminal), cannot be a macOS menu chord (⌘C ⌘V ⌘X ⌘A
⌘Z ⌘⇧Z ⌘W ⌘H ⌘M ⌘Q) or the global hotkey, and cannot repeat another shortcut. Wherever this file names one of
the six, it means the chord bound to it now.

Amended 2026-09-22 (design system): Home is the first page and takes ⌘1; Usage moves to ⌘4. A chord saved in
Settings before that day that now equals another action's default (a saved ⌘1 for Usage, with nothing saved for
Home) is dropped when read, so the two actions never share a chord; a pair the captain bound on purpose is kept.
The sidebar's other entries — Crew, Inbox, Reader — are click-only and have no palette command (Reader is a panel,
not a page; Crew and Inbox arrive with Build 3). The theme and the accent in Settings → Appearance have no key.
Amended 2026-09-23 (folder views): the Reader row is gone; see Sidebar.
Amended 2026-09-23 (the first mate, Gate 1 — these land with Build 3's code, `tasks/first-mate/prd.md`): ⌘3 goes to
the Crew page and ⌘5 to the Inbox page. Both are defaults Settings can rebind, so the defaults are eight — ⌘K, ⌘1,
⌘2, ⌘3, ⌘4, ⌘5, ⌘S and ⌘, — and the rules above hold for all eight. Crew and Inbox are no longer click-only. The
palette gains three commands: Go to Crew, Go to Inbox, and Go to the first mate (the same as the Crew page's First
mate button). ⌘5 sits after ⌘4 so Usage keeps the chord it took on 2026-09-22.

## Command palette

| Key | Action |
|---|---|
| typing | Filter commands by title |
| ↑ / ↓ | Move the selection |
| Enter | Run the selected command |
| Esc | Close the palette; focus returns to the element that had it, the terminal included |

## Terminal pane (Work page), while it has focus

**Every keystroke without ⌘ goes to the PTY**, exactly as xterm.js encodes it, with one exception: ⌫ over a
selection at the prompt (below). No app handler may act on any other key or `preventDefault` it, and no webview
default (Tab focus traversal) may consume it. That explicitly includes:

- Tab, ⇧Tab
- ⌃Tab, ⌃⇧Tab (Herdr's pane-cycling bindings)
- Esc
- every ⌃-letter, including ⌃C ⌃D ⌃Z ⌃R
- arrows, with and without modifiers
- F1–F12
- ⌥ chords — **⌥ is not Meta** (`macOptionIsMeta: false`, matching Ghostty's default)

The only ⌘ chords the app handles in the pane:

| Chord | Action |
|---|---|
| ⌘K | Open the palette |
| ⌘C | Copy the selection, if there is one; otherwise nothing |
| ⌘V | Paste (bracketed when the running program enabled bracketed paste) |
| ⌘1 / ⌘2 / ⌘4 | Switch pages (and ⌘3 / ⌘5 from Build 3) |
| ⌘S | Hide or show the sidebar |
| ⌘, | Open Settings |
| ⌘W ⌘H ⌘M ⌘Q | Standard macOS meanings, as above |

A mouse selection is also copied when the button is released, and a program's OSC 52 write (how Herdr copies)
reaches the clipboard. Nothing in the pane can read the clipboard.

The one key the app takes without ⌘:

| Key | Action |
|---|---|
| ⌫ | With a selection on one row, the cursor's row, on the normal screen (so not inside Herdr, vim or lazygit): remove the selected text, by moving the cursor to its end and sending one ⌫ per character. Any other time, ⌫ goes to the PTY |

Amended 2026-09-23 (the first mate, Gate 1 — from Build 3): when the focused Herdr pane is a crew worker's, the line
the captain types there is recorded as an order on its task when he presses Enter. Recording takes no key: every
keystroke still goes to the PTY exactly as above, and the record is made beside it, never instead of it.

## Settings page

| Key | Action |
|---|---|
| Esc | Back to the page Settings was opened from |
| Change, then a chord with ⌘ | Bind that chord. Esc cancels; while recording, no shortcut runs |

## Reader (the panel on the right, beside whichever page is showing)

Amended 2026-09-18 (three-column shell): the reader left the Work page for a panel on the right of the whole
window, and `kinas open` no longer switches pages.

The reader adds no key bindings of its own. The **Rendered** / **Source** toggle that appears on a markdown or
an `.html` file is **click-only**, and deliberately so: a binding would have to be unique against the palette
and every ⌘ shortcut above, for a two-state control that lives in one header beside the mouse. **Copy**,
**Expand** and **Close** are click-only for the same reason. If one starts being missed, that is the moment to
add it — this file stays the gate. Amended 2026-09-23 (tree changes): the toggle's third button, **Changes**, shown
while the open file has a change mark, is click-only too, and a fold's "N unchanged lines" row unfolds by click.

The header's **▾** menu is the one place the reader handles keys, and only while it is open: it takes focus when
it opens and gives it back when it closes, so that nothing typed at an open menu reaches the terminal.

| Key, in the open ▾ menu | Action |
|---|---|
| ↑ / ↓ | Move to the previous or next item, wrapping, skipping items that cannot be used |
| Home / End | First or last usable item |
| Enter, Space | Run the item |
| Esc, Tab | Close the menu; focus goes back where it was |
| The ⌘ shortcuts above | Unchanged |

| Key | Action |
|---|---|
| Space, ↑ / ↓, Page Up / Page Down, Home / End | Scroll the document: the webview's own keys, only while the reader has focus (after a click inside it) |
| The ⌘ shortcuts above | Unchanged while the reader has focus |

Opening a file (`kinas open`, a link, the file tree), a live reload and the confirmation card for a file outside
the projects root never move keyboard focus. If the terminal had it, it keeps it, so Enter goes to the PTY and can
never accept the card; Open and Dismiss take a click. Closing the reader with × gives the terminal focus while the
Work page is showing; on any other page the terminal is hidden, and focus is left where it was.

## Sidebar (the navigation, Pinned, Files, Recent, Client folders)

Added 2026-09-21 (sidebar folders). The sidebar adds no key bindings and no palette command. **Pin**, **Unpin** and
**Open in the terminal** — the buttons that show when a folder's row is pointed at — are click-only, for the reason
the reader's controls are; this file stays the gate.

Amended 2026-09-22 (design system): the navigation lists Home, Work, Crew, Inbox, Usage, Reader and Settings. Home,
Work, Usage and Settings have the chords above; **Crew**, **Inbox** and **Reader** are click-only. Reader reopens the
last document in the panel, or says at the foot of the sidebar that there is nothing to reopen. The **Client folders**
rows and the VPS row at the foot are click-only too: a folder row opens that folder in the reader, as its tree row
does. Selecting a folder's colour or marking it internal happens in Settings → Client folders, by click.

Amended 2026-09-23 (tree changes): every file tree marks what changed since it was first shown. The **↻** on a
tree's head — the Files header, an expanded pinned folder's row, and the reader's own Files label — clears that tree's
marks and starts counting again; it is **click-only**, like every sidebar action, and the palette offers the same as
**Refresh files**, for the folder Files shows. So the sidebar now has one palette command; it still adds no chord.
A click on a marked row opens the reader on its Changes view.

Amended 2026-09-23 (folder views): the navigation lists Home, Work, Crew, Inbox and Usage. The **Reader** row is
gone: a file's or a folder's row opens the reader, and × closes it. **Settings** is the sidebar's last row, at its
foot, with its chord unchanged. A right-click on a client folder (a two-finger tap, or Ctrl-click) opens its menu —
**Hide from sidebar**, **Add a client folder…**, then **Show** for each hidden folder; on the Client folders
heading, the same without Hide. The menu has no chord and no palette command. While it is open it takes the keys
exactly as the reader's ▾ menu does (the table under Reader, dividers skipped like unusable items), and when it
closes focus goes back where it was, to the terminal if the terminal had it. Hiding, showing, adding, removing and
restoring a folder are also in Settings → Client folders, by click.

**Open in the terminal** is the one sidebar action that moves you. Kinas asks Herdr, through its CLI, for that
folder's workspace — focusing the one that already carries the folder's label, creating it in that folder if there
is none — then shows the Work page and gives the terminal the keys. Nothing is typed into the pane, ever: when
Claude Code or Pi has it, typed text would arrive as a prompt. If Herdr refuses, nothing moves and the reason is
said in the reader's status line — or at the foot of the sidebar while the panel is closed.

## Crew page and Inbox page (from Build 3)

Added 2026-09-23 (the first mate, Gate 1 — land with Build 3's code). The Crew page's controls — a card, **Open its
pane**, **First mate** / **Launch the first mate**, the waiting count, **Copy** on the setup line — are click-only,
and reachable by Tab; the task detail's controls likewise. **Open its pane** and **First mate** move you the way
**Open in the terminal** does: Kinas asks Herdr, through its CLI, to focus that workspace, then shows the Work page
and gives the terminal the keys. Nothing is typed into any pane.

An inbox item — on the Inbox page, or compact on Home — takes these keys while it has focus (Tab or a click on it),
never while the terminal has focus:

| Key, on a focused inbox item | Action |
|---|---|
| A | Approve: send the approval at once |
| R | Answer: open the text box |
| D | Deny: open the text box for the reason |
| Tab / ⇧Tab | Move between items and their controls |

| Key, in an item's open text box | Action |
|---|---|
| typing | The answer (A, R and D are letters here, not actions) |
| Enter | Send |
| ⇧Enter | A new line |
| Esc | Close the box; nothing is sent |

On Home's compact items, R and D open the item on the Inbox page with its box open. An item answered in the first
mate's pane has no keys: its one button is click- and Tab-only. The client folders' right-click Menu gains **Add to
crew** after **Hide from sidebar**, with the Menu's keys as under Sidebar.

## Launch screen (the Work pane at start, and `kinas` in any terminal)

The pane opens on the Kinas launch screen. The screen reads these keys itself, as the program running in the PTY;
the app still passes every non-⌘ key through (above). Piped or redirected, `kinas` prints the screen and exits.

| Key | In the Work pane | Run by hand |
|---|---|---|
| Enter | Attach Herdr's `default` session | Close the screen |
| q, ⌃C | Stay in the shell (type `herdr` later) | Close the screen |

Every other key — Tab, arrows, escape sequences, other letters — is ignored.

## Exit message

| Key | Action |
|---|---|
| Enter | After `[process exited — press Enter to restart]`, respawn the profile |
