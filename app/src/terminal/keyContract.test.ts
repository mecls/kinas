import { describe, expect, test } from "bun:test";
import { DEFAULT_SHORTCUTS, type Shortcuts } from "../settings/shortcuts.ts";
import { decideKey, type KeyInput } from "./keyContract.ts";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keydown",
  key: k,
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const decide = (input: KeyInput, kittyFlags = 0, shortcuts: Shortcuts = DEFAULT_SHORTCUTS) => decideKey(input, kittyFlags, shortcuts);

describe("every key without ⌘ belongs to the PTY", () => {
  const passthrough: [string, Partial<KeyInput>][] = [
    ["Tab", {}],
    ["Tab", { shiftKey: true }],
    ["Escape", {}],
    ["c", { ctrlKey: true }],
    ["d", { ctrlKey: true }],
    ["z", { ctrlKey: true }],
    ["r", { ctrlKey: true }],
    ["ArrowLeft", { altKey: true }],
    ["ArrowUp", { shiftKey: true, ctrlKey: true }],
    ["F5", {}],
    ["[", { altKey: true }],
    ["k", { ctrlKey: true }],
    ["s", { ctrlKey: true }],
  ];
  for (const [k, mods] of passthrough) {
    test(`${JSON.stringify(mods)} ${k} → xterm`, () => {
      expect(decide(key(k, mods))).toEqual({ kind: "xterm" });
      expect(decide(key(k, mods), 7).kind).not.toBe("app");
    });
  }
});

describe("⌘ chords", () => {
  test("⌘K opens the palette", () => {
    expect(decide(key("k", { metaKey: true }))).toEqual({ kind: "app", action: "palette" });
    expect(decide(key("K", { metaKey: true }))).toEqual({ kind: "app", action: "palette" });
  });
  test("⌘1, ⌘2, ⌘3, ⌘4, ⌘S and ⌘, are app actions", () => {
    // keymap.md, 2026-09-22: ⌘1 is Home and ⌘4 is Usage; 2026-09-24: ⌘3 is the Crew page. ⌘5 waits for the Inbox.
    expect(decide(key("1", { metaKey: true }))).toEqual({ kind: "app", action: "go.home" });
    expect(decide(key("2", { metaKey: true }))).toEqual({ kind: "app", action: "go.work" });
    expect(decide(key("4", { metaKey: true }))).toEqual({ kind: "app", action: "go.usage" });
    expect(decide(key("3", { metaKey: true }))).toEqual({ kind: "app", action: "go.crew" });
    expect(decide(key("5", { metaKey: true }))).toEqual({ kind: "native" });
    expect(decide(key("s", { metaKey: true, code: "KeyS" }))).toEqual({ kind: "app", action: "sidebar" });
    expect(decide(key(",", { metaKey: true }))).toEqual({ kind: "app", action: "settings" });
  });
  test("⌘C, ⌘V, ⌘W, ⌘H, ⌘M, ⌘Q are left to the macOS menu", () => {
    for (const k of ["c", "v", "w", "h", "m", "q"]) {
      expect(decide(key(k, { metaKey: true }))).toEqual({ kind: "native" });
    }
  });
  test("⌘⇧K is not the palette chord", () => {
    expect(decide(key("k", { metaKey: true, shiftKey: true }))).toEqual({ kind: "native" });
  });
  test("⌘ keyup never reaches xterm", () => {
    expect(decide({ ...key("k", { metaKey: true }), type: "keyup" })).toEqual({ kind: "native" });
  });
});

describe("shortcuts rebound in Settings", () => {
  const rebound: Shortcuts = { ...DEFAULT_SHORTCUTS, sidebar: "Cmd+B", palette: "Cmd+Alt+K" };
  test("the new chord raises the action and the old one does nothing", () => {
    expect(decide(key("b", { metaKey: true, code: "KeyB" }), 0, rebound)).toEqual({ kind: "app", action: "sidebar" });
    expect(decide(key("s", { metaKey: true, code: "KeyS" }), 0, rebound)).toEqual({ kind: "native" });
    expect(decide(key("k", { metaKey: true, code: "KeyK" }), 0, rebound)).toEqual({ kind: "native" });
  });
  test("chords match the physical key, so ⌥ turning K into ˚ still finds the palette", () => {
    expect(decide(key("˚", { metaKey: true, altKey: true, code: "KeyK" }), 0, rebound)).toEqual({ kind: "app", action: "palette" });
  });
});

describe("⌫ over a selection at the prompt", () => {
  const bytes = "\x1b[D\x7f";
  const counting = (result: string | null) => {
    const calls = { count: 0 };
    return { calls, deleter: () => (calls.count++, result) };
  };

  test("a plain ⌫ sends the bytes that remove the selection", () => {
    expect(decideKey(key("Backspace"), 0, DEFAULT_SHORTCUTS, () => bytes)).toEqual({ kind: "pty", data: bytes });
  });
  test("with nothing to remove, ⌫ is left to xterm", () => {
    expect(decideKey(key("Backspace"), 0, DEFAULT_SHORTCUTS, () => null)).toEqual({ kind: "xterm" });
    expect(decide(key("Backspace"))).toEqual({ kind: "xterm" });
  });
  test("⌥⌫, ⌃⌫ and ⇧⌫ reach the PTY without inspecting the selection", () => {
    for (const mods of [{ altKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const { calls, deleter } = counting(bytes);
      expect(decideKey(key("Backspace", mods), 0, DEFAULT_SHORTCUTS, deleter)).toEqual({ kind: "xterm" });
      expect(calls.count).toBe(0);
    }
  });
  test("⌘⌫ stays with the macOS menu, and a keyup never inspects the selection", () => {
    const { calls, deleter } = counting(bytes);
    expect(decideKey(key("Backspace", { metaKey: true }), 0, DEFAULT_SHORTCUTS, deleter)).toEqual({ kind: "native" });
    expect(decideKey({ ...key("Backspace"), type: "keyup" }, 0, DEFAULT_SHORTCUTS, deleter)).toEqual({ kind: "xterm" });
    expect(calls.count).toBe(0);
  });
});

describe("⌃Tab (task 1.5)", () => {
  test("with kitty flags pushed, ⌃Tab sends CSI 9;5u", () => {
    expect(decide(key("Tab", { ctrlKey: true }), 7)).toEqual({ kind: "pty", data: "\x1b[9;5u" });
  });
  test("with kitty flags pushed, ⌃⇧Tab sends CSI 9;6u", () => {
    expect(decide(key("Tab", { ctrlKey: true, shiftKey: true }), 1)).toEqual({ kind: "pty", data: "\x1b[9;6u" });
  });
  test("without kitty flags, ⌃Tab stays xterm's default so a shell still gets a tab", () => {
    expect(decide(key("Tab", { ctrlKey: true }))).toEqual({ kind: "xterm" });
  });
  test("keyup of ⌃Tab is left to xterm", () => {
    expect(decide({ ...key("Tab", { ctrlKey: true }), type: "keyup" }, 7)).toEqual({ kind: "xterm" });
  });
});
