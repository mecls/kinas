// `kinas companion run` (build spec §11.3 B, slice 2): every 15 s one reading of Firstmate's home on this machine, written
// whole to `reading.json` for `rpc bundle` to hand the Mac. A reading is what the Mac's local cycle would read itself,
// as the scripts and programs printed it — Kinas's own parsers read it on the Mac, so nothing here interprets a fleet
// beyond picking which PRs to ask `gh` about.
//
// It runs only what firstmate.ts lists, herdr.ts's `api snapshot` and `pane process-info` on the captain's session, and
// `gh pr view <url> --json <fields>` for a URL that passed the Mac's own check. Nothing it runs changes anything. It
// also walks the worktree of each task whose worker reported done, as files (ADR 0028, `plants.ts` `scanWorktree`).

import { run } from "@kinas/context";
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CALL, installed, laneConfig, LIMITS, type Firstmate, type ScriptOut } from "./firstmate.ts";
import { HERDR, herdrAt, type Herdr, type HerdrCall } from "./herdr.ts";
import type { Paths } from "./paths.ts";
import { launchRecordFile, readLaunchRecord, scanWorktree, worktreeState, type Scan } from "./plants.ts";

export const READING_VERSION = 1;
export const READ_EVERY_MS = 15_000;
/** As the Mac's collector: capacity at most every 30 s, a PR at most every 60 s (the page's visible gap). */
export const CAPACITY_GAP_MS = 30_000;
export const PR_GAP_MS = 60_000;
/** `gh pr view`'s fields: the Mac's `gh.rs` FIELDS, never a title or body; `files` are paths only (the review flag). */
export const GH_FIELDS = "number,state,isDraft,mergeable,reviewDecision,statusCheckRollup,files,changedFiles";
const GIT_LIMIT_MS = 10_000;
const GH_LIMIT_MS = 10_000;
/** The most of the ledger one bundle carries, as the Mac's `ledger::READ_CAP`. */
export const LEDGER_CAP = 4 * 1024 * 1024;
export const LEDGER_FILE = "state/fleet-ledger.jsonl";
/** A clone's `.git/config` is small; anything larger is not read. */
const SMALL_FILE = 64 * 1024;

export interface PrOut {
  url: string;
  checked_at: number;
  out: ScriptOut;
}

export interface Reading {
  v: 1;
  at: number;
  companion: { version: string; since: number; heartbeat_at: number };
  /** Firstmate's home on this machine, as the fleet's paths name it. */
  home: string;
  installed: boolean;
  snapshot: ScriptOut | null;
  /** Only behind the lane gate; the last one is kept between its runs. */
  capacity: ScriptOut | null;
  capacity_at: number | null;
  afk: { entered: string | null; expected_return: string | null } | null;
  /** `fm-project-mode.sh <name>`'s line for each folder under `projects/`. */
  modes: Record<string, string>;
  /** Each clone under `projects/`: its `[remote "origin"]` url, read as a file, or null. */
  origins: Record<string, string | null>;
  /** `herdr api snapshot`, verbatim; null when Herdr did not answer. */
  herdr_view: string | null;
  /** `herdr pane process-info --pane <focused>`, verbatim. */
  herdr_foreground: string | null;
  /** The latest `gh pr view` of each PR still due; a PR not asked this time keeps its last answer. */
  prs: PrOut[];
  /**
   * Each task branch's `git log --name-only` (the review flag; the Mac's `touches.rs`), read at most once a gap; a branch
   * not read this time keeps its last answer while its task is not done. A branch not made yet has no entry.
   */
  branches?: BranchOut[];
  /**
   * Each worktree scan (ADR 0028): from the reading in which a task's row first says its worker reported done, until
   * the backlog says it landed, at most once a gap. A task not scanned this time keeps its last answer.
   */
  worktrees?: WorktreeOut[];
}

export interface WorktreeOut extends Scan {
  task: string;
  checked_at: number;
}

export interface BranchOut {
  task: string;
  checked_at: number;
  out: ScriptOut;
}

export interface Deps {
  paths: Paths;
  version: string;
  fm: Firstmate;
  /** The PATH children run with (paths.ts `companionPath`). */
  path: string;
  /** Herdr's session the crew runs in: `default` (ADR 0024). */
  session: string;
  clock: () => number;
  log: (line: string) => void;
  /** `gh` by the companion's PATH; replaced in tests. */
  gh?: (url: string) => Promise<ScriptOut>;
  /** `git` by the companion's PATH, with the review flag's fixed arguments; replaced in tests. */
  git?: (args: string[]) => Promise<ScriptOut>;
  /** herdr.ts's runner on `session`; replaced in tests. */
  herdr?: Herdr;
}

// ---- the fleet, only as far as choosing PRs needs ----

/** `^https://github\.com/[^/]+/[^/]+/pull/\d+$`, as `snapshot::pr_url_ok`. */
export function prUrlOk(url: string): boolean {
  const parts = url.startsWith("https://github.com/") ? url.slice("https://github.com/".length).split("/") : [];
  return parts.length === 4 && parts[0] !== "" && parts[1] !== "" && parts[2] === "pull" && /^[0-9]+$/.test(parts[3] ?? "");
}

const text = (v: unknown, path: string[]): string | null => {
  let cur: unknown = v;
  for (const k of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
  return typeof cur === "string" && cur.trim() !== "" ? cur.trim() : null;
};
const array = (v: unknown, path: string[]): unknown[] => {
  let cur: unknown = v;
  for (const k of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
  return Array.isArray(cur) ? cur : [];
};

interface TaskPr {
  id: string;
  pr: string | null;
  done: boolean;
  /** The row's `branch` and `project` (its clone): the review flag reads the branch from the clone's git folder. */
  branch?: string | null;
  project?: string | null;
  /**
   * The worker reported done: its status log's last event is `done`, or the row's state is (ADR 0028). Measured on the
   * home lab, 2026-11-25: after the report the row stays `working` while Firstmate reads the pane as busy.
   */
  reported?: boolean;
  landed?: boolean;
  /** The row's `paths.worktree.path`. */
  worktree?: string | null;
}

/** Each task's PR and whether it is done, merged as `snapshot::parse_fleet` merges a record and a row. */
export function tasksOf(snapshot: string): TaskPr[] {
  let root: unknown;
  try {
    root = JSON.parse(snapshot);
  } catch {
    return [];
  }
  const tasks = new Map<string, { pr: string | null; backlog: string | null; state: string | null; branch: string | null; project: string | null; worktree: string | null; reported: string | null }>();
  const record = (r: unknown) => ({ pr: text(r, ["pr_url"]), backlog: text(r, ["state"]), state: null as string | null, branch: null, project: null, worktree: null, reported: null });
  for (const r of array(root, ["backlog", "records"])) {
    const id = text(r, ["id"]);
    if ((r as { structured?: unknown }).structured !== true || id === null || tasks.has(id)) continue;
    tasks.set(id, record(r));
  }
  for (const row of array(root, ["tasks"])) {
    const id = text(row, ["id"]);
    if (id === null) continue;
    let t = tasks.get(id);
    if (!t) {
      const b = (row as { backlog?: unknown }).backlog;
      t = b && typeof b === "object" ? record(b) : { pr: null, backlog: null, state: null, branch: null, project: null, worktree: null, reported: null };
      tasks.set(id, t);
    }
    t.state = text(row, ["current_state", "state"]);
    t.pr = text(row, ["pr", "url"]) ?? t.pr;
    t.branch = text(row, ["branch"]);
    t.project = text(row, ["project"]);
    t.worktree = text(row, ["paths", "worktree", "path"]);
    t.reported = text(row, ["paths", "status_log", "last_event", "state"]);
  }
  return [...tasks].map(([id, t]) => ({
    id,
    pr: t.pr,
    done: t.backlog === "done" || (t.backlog === null && t.state === "done"),
    ...(t.branch !== null ? { branch: t.branch } : {}),
    ...(t.project !== null ? { project: t.project } : {}),
    reported: t.state === "done" || t.reported === "done",
    landed: t.backlog === "done",
    ...(t.worktree !== null ? { worktree: t.worktree } : {}),
  }));
}

/**
 * The PRs due a `gh pr view`: of every task not done, and of a done task whose last answer said OPEN (done work clears,
 * PRD rule 2) — valid, and not asked within the gap (a stamp in what is now the future has had its gap). Sorted.
 */
export function duePrs(tasks: TaskPr[], last: PrOut[], now: number, gap = PR_GAP_MS): string[] {
  const lastOf = new Map(last.map((p) => [p.url, p]));
  const open = (url: string) => {
    try {
      return (JSON.parse(lastOf.get(url)?.out.stdout ?? "") as { state?: unknown }).state === "OPEN";
    } catch {
      return false;
    }
  };
  const urls = tasks
    .filter((t) => t.pr !== null && (!t.done || open(t.pr)))
    .map((t) => t.pr as string)
    .filter((url) => {
      if (!prUrlOk(url)) return false;
      const at = lastOf.get(url)?.checked_at;
      return at === undefined || !(now - at >= 0 && now - at < gap);
    });
  return [...new Set(urls)].sort();
}

// ---- the review flag: a task branch's changed names (the Mac's `touches.rs`, argv for argv) ----

/** A branch name git and Firstmate both accept here (`touches::branch_ok`): never an option, never `..`. */
export function branchOk(branch: string): boolean {
  return (
    branch.length > 0 &&
    branch.length <= 200 &&
    !/^[-/]/.test(branch) &&
    !/[/.]$/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    /^[A-Za-z0-9/_.-]+$/.test(branch)
  );
}

const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

/** `touches::branch_args`: the branch's own commits' names, from the clone's git folder only. */
export function branchArgs(gitDir: string, branch: string): string[] | null {
  if (!branchOk(branch) || !gitDir.startsWith("/")) return null;
  return [...GIT_SAFE, `--git-dir=${gitDir}`, "log", "--no-renames", "--no-ext-diff", "--no-textconv", "--name-only", "--format=", "-z", `refs/heads/${branch}`, "--not", "refs/remotes/origin/HEAD", "--"];
}

/** `touches::branch_exists_args`. */
export function branchExistsArgs(gitDir: string, branch: string): string[] | null {
  if (!branchOk(branch) || !gitDir.startsWith("/")) return null;
  return [...GIT_SAFE, `--git-dir=${gitDir}`, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`];
}

/** `touches::clone_git_dir`: a clone lexically under `<home>/projects/`, its `.git` a real folder. */
export function cloneGitDir(home: string, clone: string): string | null {
  if (!clone.startsWith("/") || clone.split("/").some((p) => p === ".." || p === ".")) return null;
  const root = `${join(home, "projects")}/`;
  if (!clone.startsWith(root) || clone.length === root.length) return null;
  const git = join(clone, ".git");
  try {
    const st = lstatSync(git);
    return st.isDirectory() && !st.isSymbolicLink() ? git : null;
  } catch {
    return null;
  }
}

async function gitDefault(deps: Deps, args: string[]): Promise<ScriptOut> {
  if (deps.git) return deps.git(args);
  const env: Record<string, string> = { PATH: deps.path, HOME: process.env.HOME ?? "", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  const r = await run(["git", ...args], { env, timeoutMs: GIT_LIMIT_MS });
  return { exit: r.timedOut ? null : r.code, timed_out: r.timedOut, stdout: r.stdout, stderr_first: r.stderr.split("\n").find((l) => l.trim() !== "") ?? null };
}

/** Each task not done with a branch and a clone, not read within the gap: its log, or nothing while the branch is not made. */
async function branchesNow(deps: Deps, tasks: TaskPr[], last: BranchOut[], at: number): Promise<BranchOut[]> {
  const lastOf = new Map(last.map((b) => [b.task, b]));
  const live = tasks.filter((t) => !t.done && t.branch);
  const out: BranchOut[] = [];
  for (const t of live) {
    const prior = lastOf.get(t.id);
    if (prior && at - prior.checked_at >= 0 && at - prior.checked_at < PR_GAP_MS) {
      out.push(prior);
      continue;
    }
    const gitDir = t.project ? cloneGitDir(deps.paths.home, t.project) : null;
    const log = gitDir ? branchArgs(gitDir, t.branch!) : null;
    const exists = gitDir ? branchExistsArgs(gitDir, t.branch!) : null;
    if (log === null || exists === null) continue;
    const o = await gitDefault(deps, log);
    if (!ran(o) && !ran(await gitDefault(deps, exists))) continue;
    out.push({ task: t.id, checked_at: at, out: o });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task));
}

// ---- the worktree scan (ADR 0028) ----

/**
 * Each task whose worker reported done and that hasn't landed, scanned at most once a gap: the folder from Kinas's
 * launch record when there is one, else the row's; compared with its clone's checkout. A folder that is gone has
 * nothing left in it; one that isn't a plain folder can't be checked.
 */
export function worktreesNow(deps: Deps, tasks: TaskPr[], last: WorktreeOut[], at: number): WorktreeOut[] {
  const lastOf = new Map(last.map((w) => [w.task, w]));
  const out: WorktreeOut[] = [];
  for (const t of tasks) {
    const prior = lastOf.get(t.id);
    if (t.landed || (!t.reported && !prior)) continue;
    if (prior && at - prior.checked_at >= 0 && at - prior.checked_at < PR_GAP_MS) {
      out.push(prior);
      continue;
    }
    const record = readLaunchRecord(launchRecordFile(deps.paths.workers, t.id));
    const folder = record?.worktree ?? t.worktree ?? null;
    const state = folder === null ? "refused" : worktreeState(folder);
    if (state !== "ok") {
      out.push({ task: t.id, checked_at: at, red: [], count: 0, unknown: state === "refused" });
      continue;
    }
    const clone = t.project && cloneGitDir(deps.paths.home, t.project) ? t.project : null;
    out.push({ task: t.id, checked_at: at, ...scanWorktree(folder!, clone, record?.firstmate_local ?? null) });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task));
}

// ---- files read as files ----

/** A regular file's text, at most `cap` bytes; null for anything else — a FIFO is never opened for reading. */
function smallFile(path: string, cap = SMALL_FILE): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > cap) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** `[remote "origin"]`'s url in a git config, as the Mac's `repo::origin_url` reads it. */
export function originUrl(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const header = (line.slice(1).split("]")[0] ?? "").trim();
      const m = /^(\S+)\s+(.*)$/.exec(header);
      inOrigin = !!m && m[1]?.toLowerCase() === "remote" && m[2]?.trim() === '"origin"';
      continue;
    }
    if (!inOrigin) continue;
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim().toLowerCase() !== "url") continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value === "" ? null : value;
  }
  return null;
}

/** A clone's origin: its `.git` folder's config, or a worktree's `gitdir:` and `commondir`, as `repo::origin_repo`. */
export function cloneOrigin(folder: string): string | null {
  const git = join(folder, ".git");
  let dir: string | null = null;
  try {
    if (statSync(git).isDirectory()) dir = git;
  } catch {
    return null;
  }
  if (dir === null) {
    const line = (smallFile(git) ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("gitdir:"));
    const target = line?.slice("gitdir:".length).trim();
    if (!target) return null;
    dir = target.startsWith("/") ? target : join(folder, target);
  }
  const own = smallFile(join(dir, "config"));
  if (own !== null) return originUrl(own);
  const common = smallFile(join(dir, "commondir"))?.trim();
  if (!common) return null;
  const shared = smallFile(join(common.startsWith("/") ? common : join(dir, common), "config"));
  return shared === null ? null : originUrl(shared);
}

function projectFolders(home: string): string[] {
  try {
    return readdirSync(join(home, "projects"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ---- the ledger, for `rpc bundle` ----

export interface LedgerChunk {
  /** The file's identity on this machine, `<dev>:<ino>`: another file, or one emptied, is read from 0. */
  epoch: string;
  dev: number;
  ino: number;
  from: number;
  /** The byte after the last complete line carried; a line longer than the cap is skipped past. */
  to: number;
  text: string;
}

/** The ledger from the Mac's cursor: complete lines only, at most LEDGER_CAP bytes. Null when there is no file. */
export function ledgerSince(home: string, cursor: { epoch: string; offset: number } | null, cap = LEDGER_CAP): LedgerChunk | null {
  let fd: number;
  try {
    const st = statSync(join(home, LEDGER_FILE));
    if (!st.isFile()) return null;
    fd = openSync(join(home, LEDGER_FILE), "r");
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd, { bigint: true });
    const epoch = `${st.dev}:${st.ino}`;
    const size = Number(st.size);
    const from = cursor && cursor.epoch === epoch && size >= cursor.offset ? cursor.offset : 0;
    const want = Math.min(cap, Math.max(0, size - from));
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = readSync(fd, buf, got, want - got, from + got);
      if (n === 0) break;
      got += n;
    }
    const bytes = buf.subarray(0, got);
    const end = bytes.lastIndexOf(0x0a) + 1;
    // A single line longer than the cap would never complete: skip past it, as the Mac's reader does.
    const to = end === 0 && got >= cap ? from + got : from + end;
    return { epoch, dev: Number(st.dev), ino: Number(st.ino), from, to, text: bytes.subarray(0, end).toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

// ---- one reading ----

async function herdrDefault(deps: Deps, call: HerdrCall): Promise<string | null> {
  const herdr = deps.herdr ?? herdrAt(deps.paths.herdr, deps.session, deps.path);
  const r = await herdr(call);
  return r.ok ? r.stdout : null;
}

async function ghDefault(deps: Deps, url: string): Promise<ScriptOut> {
  if (deps.gh) return deps.gh(url);
  const env: Record<string, string> = { PATH: deps.path, HOME: process.env.HOME ?? "" };
  const r = await run(["gh", "pr", "view", url, "--json", GH_FIELDS], { env, timeoutMs: GH_LIMIT_MS });
  return { exit: r.timedOut ? null : r.code, timed_out: r.timedOut, stdout: r.stdout, stderr_first: r.stderr.split("\n").find((l) => l.trim() !== "") ?? null };
}

const ran = (o: ScriptOut) => !o.timed_out && o.exit === 0;

/** One reading of the home: runs the scripts, Herdr and `gh`, writes `reading.json` whole, and returns it. */
export async function readOnce(deps: Deps, prev: Reading | null, since: number): Promise<Reading> {
  const { fm, paths } = deps;
  const home = paths.home;
  const at = deps.clock();
  const base = { v: READING_VERSION, at, companion: { version: deps.version, since, heartbeat_at: at }, home } as const;

  // Herdr's view is read whether or not Firstmate is there: the Mac's chrome wants the first mate's pane.
  const view = await herdrDefault(deps, HERDR.snapshot());
  let foreground: string | null = null;
  if (view !== null) {
    let focused: string | null = null;
    try {
      focused = text(JSON.parse(view), ["result", "snapshot", "focused_pane_id"]);
    } catch {
      focused = null;
    }
    if (focused) foreground = await herdrDefault(deps, HERDR.processInfo(focused));
  }

  if (!installed(home)) {
    const reading: Reading = { ...base, installed: false, snapshot: null, capacity: null, capacity_at: null, afk: null, modes: {}, origins: {}, herdr_view: view, herdr_foreground: foreground, prs: [] };
    writeReading(paths, reading);
    return reading;
  }

  const snapshot = await fm.run(CALL.snapshot, LIMITS.snapshot);

  const gate = laneConfig(home);
  let capacity = prev?.capacity ?? null;
  let capacityAt = prev?.capacity_at ?? null;
  if (gate.kind === "cap" || gate.kind === "auto") {
    if (capacityAt === null || !(at - capacityAt >= 0 && at - capacityAt < CAPACITY_GAP_MS)) {
      capacity = await fm.run(CALL.capacity, LIMITS.capacity);
      capacityAt = at;
    }
  } else {
    capacity = null;
    capacityAt = null;
  }

  const field = async (name: "entered" | "expected_return") => {
    const o = await fm.run(CALL.afk(name), LIMITS.setting);
    return ran(o) && o.stdout.trim() !== "" ? o.stdout.trim() : null;
  };
  const afk = { entered: await field("entered"), expected_return: await field("expected_return") };

  const folders = projectFolders(home);
  const modes: Record<string, string> = {};
  const origins: Record<string, string | null> = {};
  for (const name of folders) {
    const o = await fm.run(CALL.mode(name), LIMITS.setting);
    if (ran(o) && o.stdout.trim() !== "") modes[name] = o.stdout.trim();
    origins[join(home, "projects", name)] = cloneOrigin(join(home, "projects", name));
  }

  // PRs: the due ones asked now, together; the rest keep their last answer while a task still names them.
  const tasks = ran(snapshot) ? tasksOf(snapshot.stdout) : [];
  const named = new Set(tasks.map((t) => t.pr).filter((u): u is string => u !== null));
  const due = duePrs(tasks, prev?.prs ?? [], at);
  const asked = await Promise.all(due.map(async (url) => ({ url, checked_at: at, out: await ghDefault(deps, url) })));
  const kept = (prev?.prs ?? []).filter((p) => named.has(p.url) && !due.includes(p.url));
  if (due.length > 0) deps.log(`companion: gh ${due.length} PRs`);
  const branches = await branchesNow(deps, tasks, prev?.branches ?? [], at);
  const worktrees = worktreesNow(deps, tasks, prev?.worktrees ?? [], at);

  const reading: Reading = {
    ...base,
    installed: true,
    snapshot,
    capacity,
    capacity_at: capacityAt,
    afk,
    modes,
    origins,
    herdr_view: view,
    herdr_foreground: foreground,
    prs: [...kept, ...asked].sort((a, b) => a.url.localeCompare(b.url)),
    branches,
    worktrees,
  };
  writeReading(paths, reading);
  return reading;
}

/** `reading.json`, replaced whole: written beside it and renamed, so `rpc bundle` never reads half a reading. */
export function writeReading(paths: Paths, reading: Reading): void {
  mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  const tmp = `${paths.reading}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(reading), { mode: 0o600 });
  renameSync(tmp, paths.reading);
}

/** The last reading on disk, when it is one this companion wrote. */
export function lastReading(paths: Paths): Reading | null {
  try {
    const r = JSON.parse(readFileSync(paths.reading, "utf8")) as Reading;
    return r.v === READING_VERSION ? r : null;
  } catch {
    return null;
  }
}

/** The loop: a reading now, then every READ_EVERY_MS, each after the last has finished. Never returns. */
export async function loop(deps: Deps, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<never> {
  const since = deps.clock();
  let prev = lastReading(deps.paths);
  for (;;) {
    const started = deps.clock();
    try {
      prev = await readOnce(deps, prev, since);
      deps.log(`companion: reading in ${deps.clock() - started} ms`);
    } catch (e) {
      deps.log(`companion: reading failed (${(e as Error).name})`);
    }
    await sleep(Math.max(0, READ_EVERY_MS - (deps.clock() - started)));
  }
}
