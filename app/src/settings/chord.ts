// Settings' hotkey recorder: a keydown → a Tauri accelerator string ("Cmd+Shift+Space"). The app rejects any
// chord without ⌘ (R30); this only translates.

export type ChordKey = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Returns null while only modifiers are held. */
export function chordFromEvent(e: ChordKey): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const modifiers = [e.metaKey && "Cmd", e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  let key: string;
  if (e.code === "Space") key = "Space";
  else if (e.code.startsWith("Key")) key = e.code.slice(3);
  else if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...modifiers, key].join("+");
}
