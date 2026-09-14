import { describe, expect, test } from "bun:test";
import { decideKey, type KeyInput } from "./keyContract.ts";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keydown",
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

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
  ];
  for (const [k, mods] of passthrough) {
    test(`${JSON.stringify(mods)} ${k} → xterm`, () => {
      expect(decideKey(key(k, mods), 0)).toEqual({ kind: "xterm" });
      expect(decideKey(key(k, mods), 7).kind).not.toBe("app");
    });
  }
});

describe("⌘ chords", () => {
  test("⌘K opens the palette", () => {
    expect(decideKey(key("k", { metaKey: true }), 0)).toEqual({ kind: "app", action: "palette" });
    expect(decideKey(key("K", { metaKey: true }), 0)).toEqual({ kind: "app", action: "palette" });
  });
  test("⌘1, ⌘2 and ⌘, are app actions", () => {
    expect(decideKey(key("1", { metaKey: true }), 0)).toEqual({ kind: "app", action: "go.usage" });
    expect(decideKey(key("2", { metaKey: true }), 0)).toEqual({ kind: "app", action: "go.work" });
    expect(decideKey(key(",", { metaKey: true }), 0)).toEqual({ kind: "app", action: "settings" });
  });
  test("⌘C, ⌘V, ⌘W, ⌘H, ⌘M, ⌘Q are left to the macOS menu", () => {
    for (const k of ["c", "v", "w", "h", "m", "q"]) {
      expect(decideKey(key(k, { metaKey: true }), 0)).toEqual({ kind: "native" });
    }
  });
  test("⌘⇧K is not the palette chord", () => {
    expect(decideKey(key("k", { metaKey: true, shiftKey: true }), 0)).toEqual({ kind: "native" });
  });
  test("⌘ keyup never reaches xterm", () => {
    expect(decideKey({ ...key("k", { metaKey: true }), type: "keyup" }, 0)).toEqual({ kind: "native" });
  });
});

describe("⌃Tab (task 1.5)", () => {
  test("with kitty flags pushed, ⌃Tab sends CSI 9;5u", () => {
    expect(decideKey(key("Tab", { ctrlKey: true }), 7)).toEqual({ kind: "pty", data: "\x1b[9;5u" });
  });
  test("with kitty flags pushed, ⌃⇧Tab sends CSI 9;6u", () => {
    expect(decideKey(key("Tab", { ctrlKey: true, shiftKey: true }), 1)).toEqual({ kind: "pty", data: "\x1b[9;6u" });
  });
  test("without kitty flags, ⌃Tab stays xterm's default so a shell still gets a tab", () => {
    expect(decideKey(key("Tab", { ctrlKey: true }), 0)).toEqual({ kind: "xterm" });
  });
  test("keyup of ⌃Tab is left to xterm", () => {
    expect(decideKey({ ...key("Tab", { ctrlKey: true }), type: "keyup" }, 7)).toEqual({ kind: "xterm" });
  });
});
