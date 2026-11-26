// Each worker's own GitHub token (ADR 0029; build spec §12 slices 5b.B–5b.C).
//
// - `workerToken`, at launch (`worker-launch`, after the settings): the clone's origin → the repository → the App's
//   installation there → a token for that repository and the three permissions, written into the worker's own folder
//   `~/.local/state/kinas/workers/<id>/` (700): `token`, `gh/config.yml`, `gh/hosts.yml` (600). Beside it,
//   `<id>.github.json` records the repository, the installation and the expiry. Any step that fails refuses the worker.
// - `tendTokens`, on every reading: a token with 15 minutes or less left is renewed while its task is listed and not
//   ended. A task the backlog says is `done` or `dropped` has its token revoked and its token file removed at once;
//   its token folder, its temp folder and its record go once no process of that task is left, so a worker still
//   running never finds its folder gone.
//
// A token is never logged, never put in a reading, never sent anywhere but GitHub.

import { lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { installationOf, mint, readApp, repoOf, revoke, RENEW_BEFORE_MS, type AppDeps, type Repo } from "./github-app.ts";
import type { Paths } from "./paths.ts";
import { cloneCommonDir } from "./plants.ts";
import { readProcs } from "./proc.ts";
import { originUrl } from "./run.ts";
import { ownFolder, tokenDir, validTaskId, workerTmp } from "./worker.ts";
import { writeWhole } from "./written.ts";

export interface TokenDeps extends AppDeps {
  paths: Pick<Paths, "state" | "home" | "workers" | "tmp" | "proc">;
}

export interface GithubRecord {
  v: 1;
  /** `owner/name`. */
  repo: string;
  installation: number;
  /** Milliseconds since the epoch. */
  expires_at: number;
  /** Set when the backlog said the task ended and its token was revoked. */
  ended_at?: number;
}

export const githubFile = (workers: string, id: string) => join(workers, `${id}.github.json`);

function small(path: string, cap = 64 * 1024): string | null {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > cap) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function readGithubRecord(file: string): GithubRecord | null {
  const text = small(file);
  if (text === null) return null;
  try {
    const r = JSON.parse(text) as Partial<GithubRecord>;
    const ok =
      r.v === 1 &&
      typeof r.repo === "string" &&
      repoOf(`https://github.com/${r.repo}`) !== null &&
      typeof r.installation === "number" &&
      Number.isSafeInteger(r.installation) &&
      typeof r.expires_at === "number" &&
      (r.ended_at === undefined || typeof r.ended_at === "number");
    return ok ? (r as GithubRecord) : null;
  } catch {
    return null;
  }
}

/** gh's own login file for the worker's folder, in the shape gh 2.46 reads without migrating (measured, 2026-11-26). */
export function hostsYml(token: string): string {
  return ["github.com:", "    users:", "        x-access-token:", `            oauth_token: ${token}`, "    git_protocol: https", `    oauth_token: ${token}`, "    user: x-access-token", ""].join("\n");
}

/** The worker's token, written by rename into its own folder; the folders made 700 when they aren't there. */
export function writeTokenFiles(dir: string, token: string): void {
  for (const f of [dir, join(dir, "gh")]) {
    const r = ownFolder(f);
    if (typeof r === "object") throw new Error(r.refused);
  }
  writeWhole(join(dir, "token"), token, 0o600);
  writeWhole(join(dir, "gh", "config.yml"), 'version: "1"\n', 0o600);
  writeWhole(join(dir, "gh", "hosts.yml"), hostsYml(token), 0o600);
}

const readToken = (dir: string) => small(join(dir, "token"), 8192)?.trim() || null;
const repoName = (r: Repo) => `${r.owner}/${r.name}`;

/** `worker-launch`'s second half: the task's token, or why the worker must not start. */
export async function workerToken(d: TokenDeps, id: string, cwd: string): Promise<{ ok: true } | { refused: string }> {
  if (!validTaskId(id)) return { refused: "FM_TASK_ID is not a task id" };
  const common = cloneCommonDir(d.paths.home, cwd);
  if (common === null) return { refused: "the worker's folder isn't a worktree of a Firstmate project" };
  const origin = originUrl(small(join(common, "config")) ?? "");
  const repo = origin === null ? null : repoOf(origin);
  if (repo === null) return { refused: "the clone's origin isn't a repository on github.com" };
  const app = readApp(d.paths, d.uid);
  if ("problem" in app) return { refused: `the GitHub App: ${app.problem}` };
  const inst = await installationOf(d, app, repo);
  if ("problem" in inst) return { refused: inst.problem };
  const minted = await mint(d, app, inst.id, repo);
  if ("problem" in minted) return { refused: minted.problem };
  const dir = tokenDir(d.paths.workers, id);
  const old = readToken(dir);
  try {
    writeTokenFiles(dir, minted.token);
    writeWhole(githubFile(d.paths.workers, id), `${JSON.stringify({ v: 1, repo: repoName(repo), installation: inst.id, expires_at: minted.expiresAt } satisfies GithubRecord)}\n`, 0o600);
  } catch {
    return { refused: "the worker's token can't be written" };
  }
  // A respawn's earlier token ends now rather than at its hour.
  if (old !== null && old !== minted.token) await revoke(d, old);
  return { ok: true };
}

/** The task ids of this user's processes now: a worker's folders stay while any process of its task is left. */
export function liveTaskIds(proc: string, uid: number): Set<string> {
  const out = new Set<string>();
  for (const p of readProcs(proc, uid)) {
    const id = p.environ?.get("FM_TASK_ID");
    if (id !== undefined && id !== "") out.add(id);
  }
  return out;
}

/** A real folder (never a link) with exactly this path under `parent`, removed; anything else left. */
function removeFolder(path: string, parent: string): boolean {
  if (dirname(path) !== parent || basename(path) === "" || basename(path) === "." || basename(path) === "..") return false;
  try {
    const st = lstatSync(path);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export interface TaskEnd {
  id: string;
  /** The backlog says `done` or `dropped`. */
  ended?: boolean;
}

/** One reading's turn: renew what is due, end what has ended. Never throws; every step stands alone. */
export async function tendTokens(d: TokenDeps, tasks: readonly TaskEnd[], live: ReadonlySet<string>, log: (line: string) => void): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(d.paths.workers);
  } catch {
    return;
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let app: ReturnType<typeof readApp> | null = null;
  for (const name of names.sort()) {
    const m = /^(.+)\.github\.json$/.exec(name);
    if (!m || !validTaskId(m[1]!)) continue;
    const id = m[1]!;
    const file = join(d.paths.workers, name);
    const rec = readGithubRecord(file);
    if (rec === null) continue;
    const dir = tokenDir(d.paths.workers, id);
    const task = byId.get(id);
    const now = d.now();
    try {
      if (task?.ended && rec.ended_at === undefined) {
        const token = readToken(dir);
        const revoked = token === null ? true : await revoke(d, token);
        rmSync(join(dir, "token"), { force: true });
        rmSync(join(dir, "gh"), { recursive: true, force: true });
        writeWhole(file, `${JSON.stringify({ ...rec, ended_at: now })}\n`, 0o600);
        log(`companion: ${id} ended: its token ${revoked ? "revoked" : "left to expire"}`);
        continue;
      }
      if (rec.ended_at !== undefined) {
        if (live.has(id)) continue;
        const tmp = workerTmp(d.paths.tmp, id);
        removeFolder(dir, d.paths.workers);
        removeFolder(tmp, join(d.paths.tmp, "kw"));
        rmSync(file, { force: true });
        log(`companion: ${id}'s folders removed`);
        continue;
      }
      if (task === undefined || rec.expires_at - now > RENEW_BEFORE_MS) continue;
      app ??= readApp(d.paths, d.uid);
      if ("problem" in app) {
        log("companion: a token is due and the GitHub App can't be read");
        continue;
      }
      const repo = repoOf(`https://github.com/${rec.repo}`)!;
      const minted = await mint(d, app, rec.installation, repo);
      if ("problem" in minted) {
        log(`companion: ${id}'s token wasn't renewed`);
        continue;
      }
      const old = readToken(dir);
      writeTokenFiles(dir, minted.token);
      writeWhole(file, `${JSON.stringify({ ...rec, expires_at: minted.expiresAt })}\n`, 0o600);
      if (old !== null && old !== minted.token) await revoke(d, old);
      log(`companion: ${id}'s token renewed`);
    } catch {
      log(`companion: ${id}'s token couldn't be tended`);
    }
  }
}
