import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, write } from "../testing/world.ts";
import { discoverRepos, readProjects, readRepo } from "./projects.ts";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "kinas-git-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repoWithHistory(): string {
  const repo = join(tempDir(), "repo");
  for (const f of ["a.txt", "b.txt", "c.txt"]) write(join(repo, f), `${f}\n`);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "First");
  write(join(repo, "b.txt"), "b changed\n");
  git(repo, "commit", "-q", "-am", "Second | with a pipe");
  return repo;
}

describe("projects through git plumbing", () => {
  test("counts what git status counts: modified, staged, untracked (a folder once) — not touched-but-unchanged files", async () => {
    const repo = repoWithHistory();
    write(join(repo, "a.txt"), "a modified\n");
    write(join(repo, "d.txt"), "new\n");
    git(repo, "add", "d.txt");
    write(join(repo, "e/f.txt"), "untracked\n");
    write(join(repo, "e/g.txt"), "untracked\n");
    // Same content, newer mtime: the index's stat data no longer matches, the content does.
    write(join(repo, "c.txt"), "c.txt\n");
    utimesSync(join(repo, "c.txt"), new Date(), new Date(Date.now() + 5_000));

    const indexBefore = readFileSync(join(repo, ".git/index"));
    const { row, commits } = await readRepo(repo, "repo");
    expect(readFileSync(join(repo, ".git/index")).equals(indexBefore)).toBe(true);

    expect(row.dirty).toBe(3);
    // git status refreshes the index, so it runs after the reading it checks.
    const porcelain = git(repo, "status", "--porcelain").trim().split("\n");
    expect(row.dirty).toBe(porcelain.length);

    expect(row.branch).toBe("main");
    expect(row.head).toMatch(/^[0-9a-f]{7}$/);
    expect(row.upstream).toBeNull();
    expect(row.ahead).toBeNull();
    expect(row.last_commit_subject).toBe("Second | with a pipe");
    expect(commits.map((c) => c.subject)).toEqual(["Second | with a pipe", "First"]);
    expect(row.error).toBeNull();
  });

  test("ahead and behind its upstream", async () => {
    const origin = repoWithHistory();
    const clone = join(tempDir(), "clone");
    git(tempDir(), "clone", "-q", origin, clone);
    write(join(clone, "z.txt"), "z\n");
    git(clone, "add", "z.txt");
    git(clone, "commit", "-q", "-m", "Local work");
    const { row } = await readRepo(clone, "clone");
    expect(row.upstream).toBe("origin/main");
    expect(row.ahead).toBe(1);
    expect(row.behind).toBe(0);
    expect(row.dirty).toBe(0);
  });

  test("an unborn branch and a detached HEAD", async () => {
    const fresh = join(tempDir(), "fresh");
    write(join(fresh, "x.txt"), "x\n");
    git(fresh, "init", "-q", "-b", "main");
    git(fresh, "add", "x.txt");
    const unborn = (await readRepo(fresh, "fresh")).row;
    expect(unborn).toMatchObject({ branch: "main", head: null, dirty: 1, last_commit_at: null });

    const repo = repoWithHistory();
    git(repo, "checkout", "-q", "--detach");
    expect((await readRepo(repo, "repo")).row.branch).toBeNull();
  });

  test("a folder that is not a readable repository is one error line, not a crash", async () => {
    const broken = join(tempDir(), "broken");
    write(join(broken, ".git"), "gitdir: /nowhere\n");
    const { row } = await readRepo(broken, "broken");
    expect(row.error).toBeTruthy();
    expect(row.dirty).toBe(0);
  });

  test("discovery finds repositories three levels down and skips node_modules and dot folders", async () => {
    const root = tempDir();
    for (const p of ["hub", "clients/acme", "clients/big/app", "clients/acme/node_modules/dep", ".hidden/repo", "a/b/c/d"]) {
      write(join(root, p, ".git/HEAD"), "ref: refs/heads/main\n");
    }
    expect((await discoverRepos(root)).map((p) => p.slice(root.length + 1))).toEqual(["a/b/c", "clients/acme", "clients/big/app", "hub"].filter((p) => p !== "a/b/c"));
  });

  test("a missing root is one honest line", async () => {
    await expect(readProjects("/no/such/root")).rejects.toThrow("no projects folder at /no/such/root");
  });

  test("two projects with one folder name are told apart by their path", async () => {
    const root = tempDir();
    for (const p of ["one/site", "two/site"]) {
      write(join(root, p, "x.txt"), "x\n");
      git(join(root, p), "init", "-q", "-b", "main");
    }
    expect((await readProjects(root)).rows.map((r) => r.name)).toEqual(["one/site", "two/site"]);
  });
});
