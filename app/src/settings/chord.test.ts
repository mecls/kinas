import { expect, test } from "bun:test";
import { chordFromEvent, type ChordKey } from "./chord.ts";

const key = (k: string, code: string, mods: Partial<ChordKey> = {}): ChordKey => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("⌘⇧Space is the default hotkey's accelerator", () => {
  expect(chordFromEvent(key(" ", "Space", { metaKey: true, shiftKey: true }))).toBe("Cmd+Shift+Space");
});

test("letters and digits use the physical key, whatever the layout or modifiers produce", () => {
  // ⌥ on a Portuguese layout turns K into a symbol; the accelerator still names K.
  expect(chordFromEvent(key("˚", "KeyK", { metaKey: true, altKey: true }))).toBe("Cmd+Alt+K");
  expect(chordFromEvent(key("!", "Digit1", { metaKey: true, shiftKey: true }))).toBe("Cmd+Shift+1");
});

test("other keys keep their names", () => {
  expect(chordFromEvent(key("F5", "F5", { metaKey: true }))).toBe("Cmd+F5");
  expect(chordFromEvent(key(",", "Comma", { metaKey: true, ctrlKey: true }))).toBe("Cmd+Ctrl+,");
});

test("a bare modifier is not a chord yet", () => {
  for (const [k, code] of [["Meta", "MetaLeft"], ["Shift", "ShiftRight"], ["Control", "ControlLeft"], ["Alt", "AltLeft"]] as const) {
    expect(chordFromEvent(key(k, code, { metaKey: true }))).toBeNull();
  }
});

test("a chord without ⌘ still translates; the app is what refuses it", () => {
  expect(chordFromEvent(key("k", "KeyK", { ctrlKey: true }))).toBe("Ctrl+K");
});
