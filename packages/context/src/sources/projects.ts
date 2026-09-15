// Projects: every git repository under the root, read through plumbing only — symbolic-ref, rev-parse, diff-index,
// ls-files, hash-object, rev-list. Nothing here writes to a repository: no index refresh, optional locks off.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { run, splitZ, type RunResult } from "../exec.ts";
import type { ProjectRow } from "../packet.ts";
import { SourceError } from "../source.ts";

const SKIP_DIRS = new Set(["node_modules", "target", "dist", "build", "vendor", "Library"]);
const MAX_DEPTH = 3;
const GIT_TIMEOUT_MS = 5_000;

export interface CommitRef {
  sha: string;
  at: number;
  author: string;
  subject: string;
}

export interface ProjectsReading {
  rows: ProjectRow[];
  /** The last twenty commits on HEAD, per project path. */
  commits: Map<string, CommitRef[]>;
}

/** Folders with a `.git` entry (a repository or a worktree), up to three levels below the root. */
export async function discoverRepos(root: string, maxDepth = MAX_DEPTH): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git")) found.push(dir);
    if (depth >= maxDepth) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
        .map((e) => walk(join(dir, e.name), depth + 1)),
    );
  }
  await walk(root, 0);
  return found.sort();
}

function gitEnv(): Record<string, string | undefined> {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
}

type Git = (args: string[], stdin?: string) => Promise<RunResult>;

function gitIn(cwd: string): Git {
  return (args, stdin) => run(["git", ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS, env: gitEnv(), stdin });
}

/**
 * Paths whose working-tree content differs from HEAD (staged or not). diff-index compares against the index's stat
 * data without refreshing it, so a file it cannot vouch for (all-zero id) is hashed and compared with HEAD's blob:
 * a touched-but-unchanged file is not counted.
 */
async function changedAgainstHead(git: Git): Promise<string[]> {
  const raw = await git(["diff-index", "-z", "--no-abbrev", "HEAD", "--"]);
  if (!raw.ok) return [];
  const parts = raw.stdout.split("\0");
  const changed: string[] = [];
  const verify: { path: string; blob: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!;
    const path = parts[i + 1]!;
    if (!meta.startsWith(":")) break;
    const [srcMode, dstMode, srcSha, dstSha, status] = meta.slice(1).split(" ");
    const unknownContent = /^0+$/.test(dstSha ?? "");
    if (status === "M" && unknownContent && srcMode === dstMode && srcMode !== "160000") {
      verify.push({ path, blob: srcSha ?? "" });
    } else {
      changed.push(path);
    }
  }
  if (verify.length > 0) {
    const hashed = await git(["hash-object", "--stdin-paths"], `${verify.map((v) => v.path).join("\n")}\n`);
    const ids = hashed.ok ? hashed.stdout.trim().split("\n") : [];
    verify.forEach((v, i) => {
      if (ids[i] !== v.blob) changed.push(v.path);
    });
  }
  return changed;
}

export function parseCommits(text: string): CommitRef[] {
  return text
    .split("\n")
    .filter((line) => line.includes("\x1f"))
    .map((line) => {
      const [sha = "", ct = "0", author = "", ...subject] = line.split("\x1f");
      return { sha, at: Number(ct) * 1000, author, subject: subject.join("\x1f") };
    });
}

export async function readRepo(path: string, name: string): Promise<{ row: ProjectRow; commits: CommitRef[] }> {
  const git = gitIn(path);
  const empty: ProjectRow = {
    name,
    path,
    branch: null,
    head: null,
    dirty: 0,
    upstream: null,
    ahead: null,
    behind: null,
    last_commit_at: null,
    last_commit_subject: null,
    artifacts: 0,
    error: null,
  };

  const top = await git(["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    const why = top.error ?? (top.stderr.trim().split("\n")[0] || "not a readable git repository");
    return { row: { ...empty, error: why }, commits: [] };
  }

  const [branch, head, upstream, log, untracked] = await Promise.all([
    git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(["rev-parse", "--verify", "--quiet", "HEAD"]),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    git(["rev-list", "--max-count=20", "--no-commit-header", "--format=%H%x1f%ct%x1f%an%x1f%s", "HEAD"]),
    git(["ls-files", "-z", "--others", "--exclude-standard", "--directory", "--no-empty-directory"]),
  ]);

  const headId = head.ok ? head.stdout.trim() : null;
  const dirty = new Set(splitZ(untracked.stdout));
  if (headId) {
    for (const p of await changedAgainstHead(git)) dirty.add(p);
  } else {
    const staged = await git(["ls-files", "-z", "--cached"]);
    for (const p of splitZ(staged.stdout)) dirty.add(p);
  }

  const upstreamName = headId && upstream.ok ? upstream.stdout.trim() : null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstreamName) {
    const counts = await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (counts.ok) {
      const [a, b] = counts.stdout.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(a) ? a! : null;
      behind = Number.isFinite(b) ? b! : null;
    }
  }

  const commits = log.ok ? parseCommits(log.stdout) : [];
  return {
    row: {
      ...empty,
      branch: branch.ok ? branch.stdout.trim() : null,
      head: headId ? headId.slice(0, 7) : null,
      dirty: dirty.size,
      upstream: upstreamName,
      ahead,
      behind,
      last_commit_at: commits[0]?.at ?? null,
      last_commit_subject: commits[0]?.subject ?? null,
    },
    commits,
  };
}

export async function readProjects(root: string): Promise<ProjectsReading> {
  if (!existsSync(root)) throw new SourceError(`no projects folder at ${root}`);
  const repos = await discoverRepos(root);
  const byBase = new Map<string, number>();
  for (const r of repos) byBase.set(basename(r), (byBase.get(basename(r)) ?? 0) + 1);
  const nameOf = (r: string) => ((byBase.get(basename(r)) ?? 0) > 1 ? relative(root, r) || basename(r) : basename(r));

  const readings = await Promise.all(repos.map((r) => readRepo(r, nameOf(r))));
  return {
    rows: readings.map((r) => r.row),
    commits: new Map(readings.map((r) => [r.row.path, r.commits])),
  };
}
