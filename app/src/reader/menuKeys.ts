// What a key does inside the reader's ▾ menu. Pure, so bun tests cover it without the DOM.
//
// The menu owns every key while it is open. It has to: WebKit does not focus a button when it is clicked, so with
// the terminal focused the keys would otherwise keep going to the PTY — Esc and the arrows included.

export type MenuKeyResult = { kind: "focus"; index: number } | { kind: "activate"; index: number } | { kind: "close" } | { kind: "none" };

/** The next enabled index from `from`, moving by `step` and wrapping; -1 when nothing is enabled. */
function seek(enabled: readonly boolean[], from: number, step: 1 | -1): number {
  const n = enabled.length;
  for (let i = 1; i <= n; i++) {
    const index = (((from + step * i) % n) + n) % n;
    if (enabled[index]) return index;
  }
  return -1;
}

/**
 * `current` is the focused item's index, or -1 when none is. Disabled items are skipped by every movement and are
 * never activated.
 */
export function menuKey(key: string, current: number, enabled: readonly boolean[]): MenuKeyResult {
  const focus = (index: number): MenuKeyResult => (index < 0 ? { kind: "none" } : { kind: "focus", index });
  switch (key) {
    case "ArrowDown":
      return focus(seek(enabled, current, 1));
    case "ArrowUp":
      // From "nothing focused", up lands on the last item, as down lands on the first.
      return focus(seek(enabled, current < 0 ? 0 : current, -1));
    case "Home":
      return focus(seek(enabled, -1, 1));
    case "End":
      return focus(seek(enabled, 0, -1));
    case "Enter":
    case " ":
      return current >= 0 && enabled[current] ? { kind: "activate", index: current } : { kind: "none" };
    case "Escape":
    case "Tab":
      return { kind: "close" };
    default:
      return { kind: "none" };
  }
}

/** The item the menu focuses when it opens: the first enabled one, or -1. */
export function firstEnabled(enabled: readonly boolean[]): number {
  return seek(enabled, -1, 1);
}
