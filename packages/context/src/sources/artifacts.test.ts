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
