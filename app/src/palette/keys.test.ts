import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PALETTE_KEYS, paletteKey } from "./keys.ts";

describe("palette keys (build-spec invariant 8)", () => {
  test("the handler acts only on Escape, ArrowUp, ArrowDown and Enter", () => {
    expect([...PALETTE_KEYS].sort()).toEqual(["ArrowDown", "ArrowUp", "Enter", "Escape"]);
    for (const key of ["Escape", "ArrowDown", "ArrowUp", "Enter"]) expect(paletteKey(key)).toBe(key as never);
    for (const key of ["Tab", " ", "a", "k", "ArrowLeft", "ArrowRight", "Home", "End", "PageDown", "Backspace"]) expect(paletteKey(key)).toBeNull();
  });

  test("Palette.tsx reads keys through the table and names no other", () => {
    const source = readFileSync(join(import.meta.dir, "Palette.tsx"), "utf8");
    expect(source).toContain("paletteKey(e.key)");
    expect(source.match(/e\.key === "/g) ?? []).toEqual([]);
  });
});
