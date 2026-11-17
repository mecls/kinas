// The palette's keys (build-spec invariant 8; keymap.md, unchanged by the interface polish): typing goes to the box, and
// these four are the only keys the palette acts on. Anything else is left to the box or the window.

export const PALETTE_KEYS = ["Escape", "ArrowDown", "ArrowUp", "Enter"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** The key the palette acts on, or null for one it leaves alone. */
export function paletteKey(key: string): PaletteKey | null {
  return (PALETTE_KEYS as readonly string[]).includes(key) ? (key as PaletteKey) : null;
}
