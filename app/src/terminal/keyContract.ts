// The keyboard contract for the terminal pane (PRD R31, keymap.md), as a pure function so it can be
// unit-tested without a browser.

import { actionForEvent, type AppAction, type Shortcuts } from "../settings/shortcuts.ts";

export type { AppAction };

export type KeyDecision =
  /** The app handles it; xterm must not see it. */
  | { kind: "app"; action: AppAction }
  /** A macOS menu shortcut (copy, paste, close, hide, minimise, quit); xterm must not see it. */
  | { kind: "native" }
  /** The app writes these bytes to the PTY itself; xterm must not also encode the key. */
  | { kind: "pty"; data: string }
  /** xterm encodes the key as usual and sends it to the PTY through onData. */
  | { kind: "xterm" };

export interface KeyInput {
  type: string;
  key: string;
  /** The physical key ("KeyK"), which shortcuts match on. */
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const CTRL_TAB = "\x1b[9;5u";
const CTRL_SHIFT_TAB = "\x1b[9;6u";

/**
 * @param kittyFlags the flags from KittyKeyboardTracker; 0 when the program has not enabled the
 *   kitty keyboard protocol.
 * @param shortcuts the in-window shortcuts as Settings has them, so a rebound chord works in the pane too.
 */
export function decideKey(ev: KeyInput, kittyFlags: number, shortcuts: Shortcuts): KeyDecision {
  if (ev.metaKey) {
    // ⌘ chords never produce terminal input, so none of them reaches the PTY. Every shortcut includes ⌘.
    if (ev.type !== "keydown") return { kind: "native" };
    const action = actionForEvent(ev, shortcuts);
    return action ? { kind: "app", action } : { kind: "native" };
  }

  if (ev.type === "keydown" && ev.key === "Tab" && ev.ctrlKey && !ev.altKey && kittyFlags > 0) {
    // xterm.js ignores Ctrl on Tab (it sends \t, or ESC[Z with Shift), which Herdr cannot tell
    // apart from Tab. Only send the kitty encoding when the program asked for the protocol;
    // a plain shell would print it as garbage.
    return { kind: "pty", data: ev.shiftKey ? CTRL_SHIFT_TAB : CTRL_TAB };
  }

  return { kind: "xterm" };
}
