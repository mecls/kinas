// A worker's worktree `.claude` and `.mcp.json` (ADR 0028; build spec §12 4.14).
//
// - `walkClaude`: every `.claude` and `.mcp.json` in a folder, and everything under each `.claude` folder, read as
//   files: no git, no link followed, no `.git` folder entered. A walk that can't finish says why.
// - `launchDenies`: a worker's `sandbox.filesystem.denyWrite`: the root `.claude` and `.mcp.json` always, and every one
//   found below the root at launch. Claude Code's sandbox takes exact paths only; a glob there does nothing (measured).
// - `PLACEHOLDERS` and `addExcludeLines`: the paths Claude Code's sandbox protects at a worktree's root and makes as
//   empty read-only files on the host when they are missing (measured, 2.1.332), kept out of `git add` through the
//   clone's `info/exclude`.
// - `LaunchRecord`: what the launch saw, in Kinas's state, out of the worker's reach.
// - `scanWorktree`: the scan before landing. Each entry is the repository's own, Firstmate's, a placeholder, or red.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** The most entries a walk reads before it gives up. */
export const WALK_LIMIT = 500_000;
/** The biggest file the scan compares: a bigger one is red. */
export const HASH_LIMIT = 16 * 1024 * 1024;
/** The most red paths a scan keeps (the Mac's `touches::KEPT`). */
export const KEPT = 20;

export type Kind = "file" | "dir" | "link" | "other";

export interface Found {
  /** Relative to the walked folder, `/`-separated. */
  path: string;
  kind: Kind;
  /** A file's size in bytes; a folder's number of entries; 0 otherwise. */
  size: number;
}

export type Walk = { found: Found[] } | { unfinished: string };

const named = (name: string) => name === ".claude" || name === ".mcp.json";

/** Every `.claude` and `.mcp.json` under `root`, and everything inside each `.claude` folder, sorted by path. */
export function walkClaude(root: string, limit = WALK_LIMIT): Walk {
  const found: Found[] = [];
  const stack: { rel: string; inside: boolean }[] = [{ rel: "", inside: false }];
  let seen = 0;
  while (stack.length > 0) {
    const { rel, inside } = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(rel === "" ? root : join(root, rel), { withFileTypes: true });
    } catch {
      return { unfinished: `${rel === "" ? "the folder" : rel} can't be read` };
    }
    seen += entries.length;
    if (seen > limit) return { unfinished: `more than ${limit} entries` };
    for (const e of entries) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      const kind: Kind = e.isSymbolicLink() ? "link" : e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
      // Git's own folder holds no worktree file; inside a `.claude` folder everything is read, a `.git` there too.
      if (kind === "dir" && e.name === ".git" && !inside) continue;
      if (inside || named(e.name)) {
        let size = 0;
        try {
          if (kind === "file") size = lstatSync(join(root, path)).size;
          else if (kind === "dir") size = readdirSync(join(root, path)).length;
        } catch {
          return { unfinished: `${path} can't be read` };
        }
        found.push({ path, kind, size });
      }
      if (kind === "dir") stack.push({ rel: path, inside: inside || e.name === ".claude" });
    }
  }
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { found };
}

/** The worker's `denyWrite`: the worktree's root `.claude` and `.mcp.json`, there or not, and every one found below. */
export function launchDenies(worktree: string, found: readonly Found[]): string[] {
  const nested = found.filter((f) => named(f.path.split("/").pop() ?? "")).map((f) => `${worktree}/${f.path}`);
  return [...new Set([`${worktree}/.claude`, `${worktree}/.mcp.json`, ...nested])].sort();
}

/**
 * The paths Claude Code 2.1.332's sandbox protects at a worktree's root, which it makes as empty read-only files there
 * when they are missing, and leaves behind (measured on the home lab, 2026-11-25). Each is one the worker can't write.
 */
export const PLACEHOLDERS = [
  ".bash_profile",
  ".bashrc",
  ".claude",
  ".claude/agents",
  ".claude/commands",
  ".claude/hooks",
  ".claude/launch.json",
  ".claude/loop.md",
  ".claude/output-styles",
  ".claude/routines",
  ".claude/scheduled_tasks.json",
  ".claude/settings.json",
  ".claude/skills",
  ".claude/workflows",
  ".gitconfig",
  ".gitmodules",
  ".idea",
  ".mcp.json",
  ".profile",
  ".ripgreprc",
  ".vscode",
  ".zprofile",
  ".zshrc",
] as const;

/** The exclude lines for the placeholders missing from `worktree`: root-anchored, sorted. */
export function placeholderLines(worktree: string): string[] {
  return PLACEHOLDERS.filter((p) => {
    try {
      lstatSync(join(worktree, p));
      return false;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT";
    }
  }).map((p) => `/${p}`);
}

/** A small regular file's text, or null: a link, a FIFO or anything else is not opened for reading. */
function smallText(path: string, cap = 64 * 1024): string | null {
  const bytes = regularBytes(path, cap);
  return bytes === null ? null : bytes.toString("utf8");
}

/** A regular file's bytes, at most `cap`, or null: opened without following a link and without blocking. */
function regularBytes(path: string, cap: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > cap) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) return null;
      off += n;
    }
    return buf;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const sha256Bytes = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * The clone's `info/exclude` for a worktree, found as files: the worktree's `.git` file, its `gitdir`, then that
 * folder's `commondir`. Only a real `.git` folder of a clone directly under `<home>/projects/` is answered.
 */
export function cloneExcludeFile(home: string, worktree: string): string | null {
  const dotgit = join(worktree, ".git");
  let gitdir: string;
  try {
    const st = lstatSync(dotgit);
    if (st.isDirectory()) gitdir = dotgit;
    else if (st.isFile()) {
      const line = (smallText(dotgit, 4096) ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("gitdir:"));
      const target = line?.slice("gitdir:".length).trim();
      if (!target) return null;
      gitdir = isAbsolute(target) ? target : resolve(worktree, target);
    } else return null;
  } catch {
    return null;
  }
  const common = smallText(join(gitdir, "commondir"), 4096)?.trim();
  const dir = common ? resolve(gitdir, common) : gitdir;
  try {
    const real = realpathSync(dir);
    const projects = realpathSync(join(home, "projects"));
    const parts = relative(projects, real).split("/");
    if (parts.length !== 2 || parts[0] === "" || parts[0] === ".." || parts[1] !== ".git") return null;
    const st = lstatSync(real);
    return st.isDirectory() && !st.isSymbolicLink() ? join(real, "info", "exclude") : null;
  } catch {
    return null;
  }
}

export const EXCLUDE_HEADER = "# Kinas (ADR 0028): Claude Code's sandbox leaves these as empty placeholders in a worker's worktree";

/** Appends the lines `file` does not hold yet, under Kinas's header once; a link is never written through. */
export function addExcludeLines(file: string, lines: readonly string[]): number {
  let text = "";
  try {
    const st = lstatSync(file);
    if (!st.isFile()) throw new Error("the exclude file is not a regular file");
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const held = new Set(text.split("\n").map((l) => l.trim()));
  const missing = lines.filter((l) => !held.has(l));
  if (missing.length === 0) return 0;
  const head = held.has(EXCLUDE_HEADER) ? [] : [EXCLUDE_HEADER];
  const add = `${text !== "" && !text.endsWith("\n") ? "\n" : ""}${[...head, ...missing].join("\n")}\n`;
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, add);
  } finally {
    closeSync(fd);
  }
  return missing.length;
}

// ---- the launch record ----

export interface LaunchRecord {
  v: 1;
  /** The worker's folder, as the wrapper passed it (`$PWD`, its `--add-dir`). */
  worktree: string;
  /** The `denyWrite` written into its settings. */
  deny: string[];
  /** The sha256 of Firstmate's `.claude/settings.local.json` at launch; null when there was none. */
  firstmate_local: string | null;
}

export const launchRecordFile = (workers: string, id: string) => join(workers, `${id}.launch.json`);

/** The sha256 of the worktree's root `.claude/settings.local.json`, a regular file; null otherwise. */
export function firstmateLocal(worktree: string): string | null {
  const bytes = regularBytes(join(worktree, ".claude", "settings.local.json"), HASH_LIMIT);
  return bytes === null ? null : sha256Bytes(bytes);
}

/** A launch record Kinas wrote, or null. */
export function readLaunchRecord(file: string): LaunchRecord | null {
  const text = smallText(file, 1024 * 1024);
  if (text === null) return null;
  try {
    const r = JSON.parse(text) as Partial<LaunchRecord>;
    const ok =
      r.v === 1 &&
      typeof r.worktree === "string" &&
      r.worktree.startsWith("/") &&
      Array.isArray(r.deny) &&
      r.deny.every((p) => typeof p === "string") &&
      (r.firstmate_local === null || typeof r.firstmate_local === "string");
    return ok ? (r as LaunchRecord) : null;
  } catch {
    return null;
  }
}

/** Whether a launch record's denies hold the worktree's root `.claude` and `.mcp.json`, each path under the worktree. */
export function denyCoversRoot(r: LaunchRecord): boolean {
  return (
    r.deny.includes(`${r.worktree}/.claude`) &&
    r.deny.includes(`${r.worktree}/.mcp.json`) &&
    r.deny.every((p) => p.startsWith(`${r.worktree}/`) && !p.split("/").some((s) => s === ".." || s === "."))
  );
}

// ---- the scan ----

export interface Scan {
  /** The red paths, relative to the worktree, sorted, at most KEPT. */
  red: string[];
  /** How many paths were red in all. */
  count: number;
  /** The walk could not finish: nothing is known, and the card asks for review. */
  unknown: boolean;
}

/** A worktree path the scan may walk: absolute, no `.` or `..`, a real folder; null when it is not there at all. */
export function worktreeState(path: string): "ok" | "gone" | "refused" {
  if (!path.startsWith("/") || path.split("/").some((s) => s === "." || s === "..") || path.split("/").filter(Boolean).length < 2) return "refused";
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink() ? "ok" : "refused";
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "refused";
  }
}

/** Whether `f` is the same in the clone's checkout: the same kind, and a file's bytes or a link's target the same. */
function sameInClone(worktree: string, clone: string, f: Found): boolean {
  const there = join(clone, f.path);
  try {
    const st = lstatSync(there);
    if (f.kind === "dir") return st.isDirectory() && !st.isSymbolicLink();
    if (f.kind === "link") return st.isSymbolicLink() && readlinkSync(there) === readlinkSync(join(worktree, f.path));
    if (f.kind !== "file" || !st.isFile() || st.size !== f.size) return false;
    const a = regularBytes(join(worktree, f.path), HASH_LIMIT);
    const b = regularBytes(there, HASH_LIMIT);
    return a !== null && b !== null && a.equals(b);
  } catch {
    return false;
  }
}

export type Verdict = "own" | "firstmate" | "placeholder" | "container" | "red";

/**
 * One entry's class (ADR 0028, "The worktree scan"):
 * - the repository's own: the same in the clone's checkout;
 * - Firstmate's: the root `.claude/settings.local.json` with the sha256 recorded at launch;
 * - a placeholder: an empty file or folder in the root `.claude`, or an empty root `.mcp.json` — the only places the
 *   sandbox makes them, and places the worker can't write;
 * - a container: a folder in the root `.claude` that holds something (what it holds is judged on its own);
 * - red: anything else, empty or not.
 */
export function judge(worktree: string, clone: string | null, firstmate: string | null, f: Found): Verdict {
  if (clone !== null && sameInClone(worktree, clone, f)) return "own";
  if (f.path === ".claude/settings.local.json" && f.kind === "file" && firstmate !== null) {
    const bytes = regularBytes(join(worktree, f.path), HASH_LIMIT);
    if (bytes !== null && sha256Bytes(bytes) === firstmate) return "firstmate";
  }
  const root = f.path === ".mcp.json" || f.path === ".claude" || f.path.startsWith(".claude/");
  if (root && f.kind === "dir") return f.size === 0 ? "placeholder" : "container";
  if (root && f.kind === "file" && f.size === 0) return "placeholder";
  return "red";
}

/** The scan of one worktree, against its clone's checkout (null: none to compare with) and Firstmate's recorded file. */
export function scanWorktree(worktree: string, clone: string | null, firstmate: string | null, limit = WALK_LIMIT): Scan {
  const walk = walkClaude(worktree, limit);
  if ("unfinished" in walk) return { red: [], count: 0, unknown: true };
  const red = walk.found.filter((f) => judge(worktree, clone, firstmate, f) === "red").map((f) => f.path);
  return { red: red.slice(0, KEPT), count: red.length, unknown: false };
}
