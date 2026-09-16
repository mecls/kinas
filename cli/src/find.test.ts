import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateNames, findByName } from "./find.ts";

// Finding a markdown file by name under the projects folder (R1b), so `kinas open reader.md` works from any folder.

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "kinas-find-")));
for (const dir of ["a/docs", "b", "b/node_modules/pkg", "b/.hidden", "deep/1/2/3/4/5/6/7/8/9"]) mkdirSync(join(root, dir), { recursive: true });
const write = (path: string, seconds: number) => {
  writeFileSync(join(root, path), "# x\n");
  utimesSync(join(root, path), new Date(seconds * 1000), new Date(seconds * 1000));
};
write("a/docs/reader.md", 2000);
write("b/reader.md", 3000);
write("b/node_modules/pkg/reader.md", 4000);
write("b/.hidden/reader.md", 4000);
write("a/only.mdx", 1000);
write("a/notes.txt", 1000);
write("deep/1/2/3/4/5/6/7/8/9/buried.md", 1000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("names a bare argument may mean", () => {
  test("with an extension it is taken as given; without one, .md and .mdx", () => {
    expect(candidateNames("reader.md")).toEqual(["reader.md"]);
    expect(candidateNames("Reader.MD")).toEqual(["reader.md"]);
    expect(candidateNames("reader")).toEqual(["reader.md", "reader.mdx"]);
    expect(candidateNames("./reader.md")).toEqual(["reader.md"]);
  });

  test("a path is not a name, so it is never searched for", () => {
    expect(candidateNames("docs/reader.md")).toEqual([]);
    expect(candidateNames("../reader.md")).toEqual([]);
  });
});

describe("the search", () => {
  test("finds every match, newest first, and skips build output and hidden folders", () => {
    const paths = findByName(root, "reader.md").map((m) => m.path);
    expect(paths).toEqual([join(root, "b/reader.md"), join(root, "a/docs/reader.md")]);
  });

  test("matches a name without its extension, and is case-insensitive", () => {
    expect(findByName(root, "only").map((m) => m.path)).toEqual([join(root, "a/only.mdx")]);
    expect(findByName(root, "READER.md")).toHaveLength(2);
  });

  test("finds nothing for a name that is not markdown, or is too deep", () => {
    expect(findByName(root, "notes.txt")).toEqual([]);
    expect(findByName(root, "buried.md")).toEqual([]);
    expect(findByName(root, "nothing.md")).toEqual([]);
  });
});
