import { describe, expect, test } from "bun:test";
import type { ProjectRow } from "../api.ts";
import { seatFolders } from "./folders.ts";

const row = (name: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({ name, path: `/root/${name}`, display: `~/root/${name}`, category: null, internal: false, ...extra });

describe("seatFolders", () => {
  test("internal folders last, each in its chosen category or the next free one its name gives", () => {
    const seated = seatFolders([row("kinas", { internal: true }), row("acme"), row("globex", { category: 3 })]);
    expect(seated.map((f) => [f.name, f.internal])).toEqual([
      ["acme", false],
      ["globex", false],
      ["kinas", true],
    ]);
    expect(seated.find((f) => f.name === "globex")!.cat).toBe(3);
    // Six colours for six folders: no two of the three share one.
    expect(new Set(seated.map((f) => f.cat)).size).toBe(3);
  });

  test("the same folders seat the same way every time, whatever order they arrive in", () => {
    const a = seatFolders([row("acme"), row("globex"), row("initech")]);
    const b = seatFolders([row("initech"), row("acme"), row("globex")]);
    const cats = (seated: typeof a) => Object.fromEntries(seated.map((f) => [f.name, f.cat]));
    expect(cats(b)).toEqual(cats(a));
  });
});
