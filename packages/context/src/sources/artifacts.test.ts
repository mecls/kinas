import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, write } from "../testing/world.ts";
import { firstHeading, isArtifact, readArtifacts } from "./artifacts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("artifacts by convention", () => {
  test("which markdown files define a project", () => {
    const yes = ["AGENTS.md", "app/AGENTS.md", "README.md", "docs/a.md", "docs/deep/b.mdx", "plans/q3.md", "specs/api.md", "src/con-naming.md", "spec-auth.md", "x/plan-launch.md", "epic-billing.md"];
    const no = ["app/README.md", "notes.md", "tasks/prd.md", "docs.md", "src/docs/a.md", "spec-auth.txt", "concept.md", "README.txt"];
    for (const p of yes) expect([p, isArtifact(p)]).toEqual([p, true]);
    for (const p of no) expect([p, isArtifact(p)]).toEqual([p, false]);
  });

  test("the title is the first heading after front matter, outside code fences", () => {
    expect(firstHeading("---\ntitle: nope\n---\n\n# Real title\n")).toBe("Real title");
    expect(firstHeading("```\n# in a fence\n```\n## Second level ##\n")).toBe("Second level");
    expect(firstHeading("no headings here\n")).toBeNull();
  });

  test("tracked and untracked-but-not-ignored files, with titles and times, never contents", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kinas-art-"));
    dirs.push(repo);
    write(join(repo, "README.md"), "# Readme\n");
    write(join(repo, ".gitignore"), "ignored/\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    write(join(repo, "docs/new.md"), "# New doc\n");
    write(join(repo, "ignored/spec-x.md"), "# Ignored\n");
    const { rows, omitted } = await readArtifacts({ name: "p", path: repo });
    expect(rows.map((r) => [r.path, r.title])).toEqual([
      ["README.md", "Readme"],
      ["docs/new.md", "New doc"],
    ]);
    expect(rows.every((r) => r.modified_at > 0 && r.project === "p")).toBe(true);
    expect(omitted).toBe(0);
  });
});

test("a title's code fences open and close as CommonMark has them, as a convention's do (nestHeadings)", () => {
  // `firstHeading` took any line starting with three backticks or tildes for a fence, either kind closing either: a
  // README opening on an inline ```code``` line hid its title, and a ``` line inside a ~~~ fence closed it, so the
  // heading after the fence was skipped — the Artifacts table showed "—" for both.
  expect(firstHeading("```npm i``` installs it.\n# Acme storefront 9c2e\n")).toBe("Acme storefront 9c2e");
  expect(firstHeading("~~~\n```\n~~~\n# Title 9c2e\n")).toBe("Title 9c2e");
  expect(firstHeading("````\n```\n# kept\n````\n# After 9c2e\n")).toBe("After 9c2e");
  // CRLF files close their fences too.
  expect(firstHeading("```sh\r\n# a comment\r\n```\r\n# Real 9c2e\r\n")).toBe("Real 9c2e");
  // Four spaces in is indented code, not a fence: the heading after it is the title.
  expect(firstHeading("    ```\n# Indented 9c2e\n")).toBe("Indented 9c2e");
});
