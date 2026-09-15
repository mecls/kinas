import { describe, expect, test } from "bun:test";
import type { ChordKey } from "./chord.ts";
import { actionForEvent, chordLabel, DEFAULT_SHORTCUTS, shortcutProblem, withDefaults } from "./shortcuts.ts";

const press = (key: string, code: string, mods: Partial<ChordKey> = {}): ChordKey => ({
  key,
  code,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("the default shortcuts (keymap.md)", () => {
  test("⌘K ⌘1 ⌘2 ⌘S ⌘, raise their actions", () => {
    expect(actionForEvent(press("k", "KeyK"), DEFAULT_SHORTCUTS)).toBe("palette");
    expect(actionForEvent(press("1", "Digit1"), DEFAULT_SHORTCUTS)).toBe("go.usage");
    expect(actionForEvent(press("2", "Digit2"), DEFAULT_SHORTCUTS)).toBe("go.work");
    expect(actionForEvent(press("s", "KeyS"), DEFAULT_SHORTCUTS)).toBe("sidebar");
    expect(actionForEvent(press(",", "Comma"), DEFAULT_SHORTCUTS)).toBe("settings");
  });

  test("an extra modifier, or no ⌘, is a different chord", () => {
    expect(actionForEvent(press("s", "KeyS", { shiftKey: true }), DEFAULT_SHORTCUTS)).toBeNull();
    expect(actionForEvent(press("s", "KeyS", { metaKey: false }), DEFAULT_SHORTCUTS)).toBeNull();
    expect(actionForEvent(press("Meta", "MetaLeft"), DEFAULT_SHORTCUTS)).toBeNull();
  });
});

describe("saved shortcuts", () => {
  test("override the defaults action by action", () => {
    expect(withDefaults({ sidebar: "Cmd+B" })).toEqual({ ...DEFAULT_SHORTCUTS, sidebar: "Cmd+B" });
    expect(actionForEvent(press("b", "KeyB"), withDefaults({ sidebar: "Cmd+B" }))).toBe("sidebar");
  });

  test("an unknown action or a chord without ⌘ is ignored", () => {
    expect(withDefaults({ launch: "Cmd+L", sidebar: "Ctrl+B" })).toEqual(DEFAULT_SHORTCUTS);
    expect(withDefaults(null)).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe("what a shortcut cannot be", () => {
  const hotkey = "Cmd+Shift+Space";

  test("a chord without ⌘", () => {
    expect(shortcutProblem("sidebar", "Ctrl+B", DEFAULT_SHORTCUTS, hotkey)).toBe("A shortcut must include ⌘, so it never takes a key from the terminal");
    expect(shortcutProblem("hotkey", "Shift+Space", DEFAULT_SHORTCUTS, hotkey)).toBe("The global hotkey must include ⌘");
  });

  test("a macOS menu chord", () => {
    expect(shortcutProblem("sidebar", "Cmd+C", DEFAULT_SHORTCUTS, hotkey)).toBe("⌘C belongs to macOS (Copy)");
    expect(shortcutProblem("hotkey", "Cmd+Q", DEFAULT_SHORTCUTS, hotkey)).toBe("⌘Q belongs to macOS (Quit)");
  });

  test("another action's chord, or the global hotkey", () => {
    expect(shortcutProblem("sidebar", "Cmd+1", DEFAULT_SHORTCUTS, hotkey)).toBe("⌘1 is already the shortcut for Go to Usage");
    expect(shortcutProblem("sidebar", hotkey, DEFAULT_SHORTCUTS, hotkey)).toBe("⌘⇧Space is the global hotkey");
    expect(shortcutProblem("hotkey", "Cmd+K", DEFAULT_SHORTCUTS, hotkey)).toBe("⌘K is already the shortcut for Open the command palette");
  });

  test("its own chord again, or a free one, is fine", () => {
    expect(shortcutProblem("sidebar", "Cmd+S", DEFAULT_SHORTCUTS, hotkey)).toBeNull();
    expect(shortcutProblem("sidebar", "Cmd+B", DEFAULT_SHORTCUTS, hotkey)).toBeNull();
    expect(shortcutProblem("hotkey", hotkey, DEFAULT_SHORTCUTS, hotkey)).toBeNull();
  });
});

test("labels read the way keymap.md writes chords", () => {
  expect(chordLabel("Cmd+Shift+Space")).toBe("⌘⇧Space");
  expect(chordLabel("Cmd+,")).toBe("⌘,");
  expect(chordLabel("Cmd+Shift++")).toBe("⌘⇧+");
  expect(chordLabel("Cmd+Alt+ArrowUp")).toBe("⌘⌥↑");
});
