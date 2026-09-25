import { expect, test } from "bun:test";
import { inboxKey } from "./inboxKeys.ts";

// keymap.md's inbox keys: A, R, D on a focused item; nothing with a modifier or while the box is open.

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

test("A, R and D map on every item, either case", () => {
  expect(inboxKey(key("a"), { boxOpen: false })).toBe("approve");
  expect(inboxKey(key("A"), { boxOpen: false })).toBe("approve");
  expect(inboxKey(key("r"), { boxOpen: false })).toBe("answer");
  expect(inboxKey(key("D"), { boxOpen: false })).toBe("deny");
  expect(inboxKey(key("x"), { boxOpen: false })).toBeNull();
  expect(inboxKey(key("Enter"), { boxOpen: false })).toBeNull();
});

test("⌘ chords and an open box are never the item's", () => {
  expect(inboxKey(key("a", { metaKey: true }), { boxOpen: false })).toBeNull();
  expect(inboxKey(key("d", { ctrlKey: true }), { boxOpen: false })).toBeNull();
  expect(inboxKey(key("r", { altKey: true }), { boxOpen: false })).toBeNull();
  expect(inboxKey(key("a"), { boxOpen: true })).toBeNull();
});
