import { describe, expect, test } from "bun:test";
import { firstEnabled, itemsOf, menuKey } from "./menuKeys.ts";

const ALL = [true, true, true, true];
// Download and Print disabled, as on a folder with no file showing.
const SOME = [false, false, true, true];

describe("a menu's keys (the reader's ▾, the client folders' right-click)", () => {
  test("opens on the first item that can be used", () => {
    expect(firstEnabled(ALL)).toBe(0);
    expect(firstEnabled(SOME)).toBe(2);
    expect(firstEnabled([false, false])).toBe(-1);
    expect(firstEnabled([])).toBe(-1);
  });

  test("the arrows move one item and wrap at both ends", () => {
    expect(menuKey("ArrowDown", 0, ALL)).toEqual({ kind: "focus", index: 1 });
    expect(menuKey("ArrowDown", 3, ALL)).toEqual({ kind: "focus", index: 0 });
    expect(menuKey("ArrowUp", 1, ALL)).toEqual({ kind: "focus", index: 0 });
    expect(menuKey("ArrowUp", 0, ALL)).toEqual({ kind: "focus", index: 3 });
  });

  test("with nothing focused, down lands on the first item and up on the last", () => {
    expect(menuKey("ArrowDown", -1, ALL)).toEqual({ kind: "focus", index: 0 });
    expect(menuKey("ArrowUp", -1, ALL)).toEqual({ kind: "focus", index: 3 });
  });

  test("every movement skips a disabled item", () => {
    expect(menuKey("ArrowDown", 3, SOME)).toEqual({ kind: "focus", index: 2 });
    expect(menuKey("ArrowUp", 2, SOME)).toEqual({ kind: "focus", index: 3 });
    expect(menuKey("Home", 3, SOME)).toEqual({ kind: "focus", index: 2 });
    expect(menuKey("End", 2, [true, true, false, false])).toEqual({ kind: "focus", index: 1 });
  });

  test("Home and End go to the ends", () => {
    expect(menuKey("Home", 2, ALL)).toEqual({ kind: "focus", index: 0 });
    expect(menuKey("End", 0, ALL)).toEqual({ kind: "focus", index: 3 });
  });

  test("Enter and Space run the focused item, and never a disabled one", () => {
    expect(menuKey("Enter", 2, SOME)).toEqual({ kind: "activate", index: 2 });
    expect(menuKey(" ", 3, SOME)).toEqual({ kind: "activate", index: 3 });
    expect(menuKey("Enter", 0, SOME)).toEqual({ kind: "none" });
    expect(menuKey("Enter", -1, ALL)).toEqual({ kind: "none" });
  });

  test("Esc and Tab close it", () => {
    expect(menuKey("Escape", 0, ALL)).toEqual({ kind: "close" });
    expect(menuKey("Tab", 0, ALL)).toEqual({ kind: "close" });
  });

  test("a menu with nothing enabled moves nowhere, and any other key does nothing", () => {
    expect(menuKey("ArrowDown", -1, [false, false])).toEqual({ kind: "none" });
    expect(menuKey("a", 0, ALL)).toEqual({ kind: "none" });
  });
});

describe("a divider is not an item", () => {
  test("the arrows move over the items alone, so an index lands on the item it names", () => {
    const entries = [{ id: "hide" }, { id: "add" }, { id: "rule", divider: true as const }, { id: "show-acme" }];
    const items = itemsOf(entries);
    expect(items.map((i) => i.id)).toEqual(["hide", "add", "show-acme"]);
    // Down from "add" is "show-acme", never the divider between them.
    const next = menuKey("ArrowDown", 1, items.map(() => true));
    expect(next).toEqual({ kind: "focus", index: 2 });
    expect(items[2]!.id).toBe("show-acme");
  });
});
