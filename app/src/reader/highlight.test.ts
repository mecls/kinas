import { describe, expect, test } from "bun:test";
import { grammarFor } from "./highlight.ts";

// Which grammar a `language-*` class asks for (reader R10, R11): source blocks and markdown fences alike.

describe("a code block's grammar", () => {
  test("a source file's class is already a highlight.js id", () => {
    expect(grammarFor("typescript")).toBe("typescript");
    expect(grammarFor("sql")).toBe("sql");
    expect(grammarFor("toml")).toBe("toml");
  });

  test("a markdown fence says what its author typed, and the short names map as extensions do", () => {
    // ```ts in a plan highlights as a .ts file does; it used to ask for a grammar called "ts", which none is.
    expect(grammarFor("ts")).toBe("typescript");
    expect(grammarFor("js")).toBe("javascript");
    expect(grammarFor("sh")).toBe("bash");
    expect(grammarFor("py")).toBe("python");
    expect(grammarFor("yml")).toBe("yaml");
    expect(grammarFor("html")).toBe("xml");
    expect(grammarFor("TS")).toBe("typescript");
  });

  test("an unknown fence, or one named like a property of every object, stays plain", () => {
    expect(grammarFor("prisma")).toBeNull();
    expect(grammarFor("")).toBeNull();
    for (const name of ["constructor", "__proto__", "hasOwnProperty", "toString"]) expect(grammarFor(name)).toBeNull();
  });
});
