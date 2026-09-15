import { describe, expect, test } from "bun:test";
import { splitFrontmatter } from "./frontmatter.ts";

describe("frontmatter (R25)", () => {
  test("a mapping becomes a card: title as its heading, lists joined, nested values as JSON", () => {
    const { frontmatter, body } = splitFrontmatter("---\ntitle: Reader plan\nstatus: draft\ntags: [a, b]\nowner:\n  name: M\n---\n# Body\n");
    expect(frontmatter).toEqual({
      ok: true,
      title: "Reader plan",
      rows: [
        { key: "status", value: "draft" },
        { key: "tags", value: "a, b" },
        { key: "owner", value: '{"name":"M"}' },
      ],
    });
    expect(body).toBe("# Body\n");
  });

  test("aliases, a list or a bare scalar give the could-not-be-read card with the raw block", () => {
    expect(splitFrontmatter("---\nbase: &b 1\ncopy: *b\n---\nx")).toMatchObject({ frontmatter: { ok: false, raw: "base: &b 1\ncopy: *b" } });
    expect(splitFrontmatter("---\n- a\n- b\n---\nx").frontmatter).toMatchObject({ ok: false });
    expect(splitFrontmatter("---\njust text\n---\nx").frontmatter).toMatchObject({ ok: false });
    expect(splitFrontmatter("---\na: [unclosed\n---\nx").frontmatter).toMatchObject({ ok: false });
  });

  test("no closing line within 200 lines means no frontmatter and an unchanged body", () => {
    const text = `---\n${"line\n".repeat(250)}---\n`;
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
    expect(splitFrontmatter("# No frontmatter\n---\n")).toEqual({ frontmatter: null, body: "# No frontmatter\n---\n" });
  });

  test("a BOM, CRLF endings and a `...` close still work; an empty block gives no card", () => {
    expect(splitFrontmatter("﻿---\r\ntitle: T\r\n...\r\nbody").frontmatter).toEqual({ ok: true, title: "T", rows: [] });
    expect(splitFrontmatter("---\n---\nbody")).toEqual({ frontmatter: null, body: "body" });
  });
});
