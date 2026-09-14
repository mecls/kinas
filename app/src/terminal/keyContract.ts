// The keyboard contract for the terminal pane (PRD R31, keymap.md), as a pure function so it can be
// unit-tested without a browser.

export type AppAction = "palette" | "go.usage" | "go.work" | "settings";

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
 */
export function decideKey(ev: KeyInput, kittyFlags: number): KeyDecision {
  if (ev.metaKey) {
    // ⌘ chords never produce terminal input, so none of them reaches the PTY.
    if (ev.type !== "keydown") return { kind: "native" };
    const plain = !ev.ctrlKey && !ev.altKey && !ev.shiftKey;
    const key = ev.key.toLowerCase();
    if (plain && key === "k") return { kind: "app", action: "palette" };
    if (plain && key === "1") return { kind: "app", action: "go.usage" };
    if (plain && key === "2") return { kind: "app", action: "go.work" };
    if (plain && key === ",") return { kind: "app", action: "settings" };
    return { kind: "native" };
  }

  if (ev.type === "keydown" && ev.key === "Tab" && ev.ctrlKey && !ev.altKey && kittyFlags > 0) {
    // xterm.js ignores Ctrl on Tab (it sends \t, or ESC[Z with Shift), which Herdr cannot tell
    // apart from Tab. Only send the kitty encoding when the program asked for the protocol;
    // a plain shell would print it as garbage.
    return { kind: "pty", data: ev.shiftKey ? CTRL_SHIFT_TAB : CTRL_TAB };
  }

  return { kind: "xterm" };
}
