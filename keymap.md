# Kinas keymap

Every key binding in Kinas, on every surface. A binding is added here **before** the code that
registers it (PRD rule 5). A binding in code that is not listed here is a bug.

## Global (system-wide)

| Chord | Action | Notes |
|---|---|---|
| ⌘⇧Space | Bring Kinas forward and open the palette | Configurable in Settings. Must always contain ⌘ (R30): ⌘ chords never produce terminal input, so the pane contract holds while it is registered. Never ⌘K. If registration fails, Settings shows "hotkey unavailable" and no other chord is registered. |

## In the Kinas window

| Chord | Action |
|---|---|
| ⌘K | Open the command palette |
| ⌘1 | Go to the Usage page |
| ⌘2 | Go to the Work page |
| ⌘, | Open the Settings sheet |
| ⌘W | Hide the window (the app, readers and terminal keep running) |
| ⌘H | Hide Kinas (macOS standard) |
| ⌘M | Minimise the window (macOS standard) |
| ⌘Q | Quit Kinas (the terminal child gets SIGHUP, then SIGKILL after 2 s) |

## Command palette

| Key | Action |
|---|---|
| typing | Filter commands by title |
| ↑ / ↓ | Move the selection |
| Enter | Run the selected command |
| Esc | Close the palette; focus returns to the element that had it, the terminal included |

## Terminal pane (Work page), while it has focus

**Every keystroke without ⌘ goes to the PTY**, exactly as xterm.js encodes it. No app handler may act
on it or `preventDefault` it, and no webview default (Tab focus traversal) may consume it. That
explicitly includes:

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
| ⌘1 / ⌘2 | Switch pages |
| ⌘, | Open Settings |
| ⌘W ⌘H ⌘M ⌘Q | Standard macOS meanings, as above |

## Exit message

| Key | Action |
|---|---|
| Enter | After `[process exited — press Enter to restart]`, respawn the profile |
