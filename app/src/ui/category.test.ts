import { describe, expect, test } from "bun:test";
import { categoriesFor, hashedCategory } from "./category.ts";

describe("a client folder's category (DESIGN.md §3.1)", () => {
  test("the hash is stable and lands in 1–6", () => {
    expect(hashedCategory("hub")).toBe(hashedCategory("hub"));
    for (const name of ["hub", "acme", "app", "one/site", "two/site", ""]) {
      expect(hashedCategory(name)).toBeGreaterThanOrEqual(1);
      expect(hashedCategory(name)).toBeLessThanOrEqual(6);
    }
  });

  test("a choice wins over the hash, and is never moved by a later folder", () => {
    const cats = categoriesFor(["hub", "acme"], { hub: 4 });
    expect(cats.hub).toBe(4);
    expect(cats.acme).not.toBe(4);
    // A choice outside the six is treated as none.
    expect(categoriesFor(["hub"], { hub: 9 }).hub).toBe(hashedCategory("hub"));
    expect(categoriesFor(["hub"], { hub: null }).hub).toBe(hashedCategory("hub"));
  });

  test("a collision takes the next free colour, and the seventh folder repeats one", () => {
    // Two names on the same seed: the second moves on, the first keeps its own.
    const a = "hub";
    let b = "x";
    for (let i = 0; hashedCategory(b) !== hashedCategory(a); i++) b = `x${i}`;
    const two = categoriesFor([a, b], {});
    expect(two[a]).toBe(hashedCategory(a));
    expect(two[b]).toBe(((hashedCategory(a) % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6);
    // Six folders wear six colours; a seventh must share, and does so by its own hash.
    const names = Array.from({ length: 7 }, (_, i) => `folder-${i}`);
    const seven = categoriesFor(names, {});
    expect(new Set(names.slice(0, 6).map((n) => seven[n])).size).toBe(6);
    expect(seven["folder-6"]).toBe(hashedCategory("folder-6"));
  });

  test("the answer depends on the order given, not on anything else — so callers sort first", () => {
    expect(categoriesFor(["b", "a"], {})).toEqual(categoriesFor(["b", "a"], {}));
  });
});
