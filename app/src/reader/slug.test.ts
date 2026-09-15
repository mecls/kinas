import { describe, expect, test } from "bun:test";
import { slugger, slugify } from "./slug.ts";

describe("heading slugs (R24)", () => {
  test("follow GitHub: punctuation dropped, spaces to hyphens, the double hyphen kept", () => {
    expect(slugify("Setup")).toBe("setup");
    expect(slugify("R31 — the pane contract")).toBe("r31--the-pane-contract");
    expect(slugify("Ção ✓")).toBe("ção-");
    expect(slugify("snake_case and `code`")).toBe("snake_case-and-code");
  });

  test("repeats get -1, -2 in document order, and never collide with a real heading", () => {
    const slug = slugger();
    expect([slug("Setup"), slug("Setup"), slug("Setup-1"), slug("Setup")]).toEqual(["setup", "setup-1", "setup-1-1", "setup-2"]);
  });
});
