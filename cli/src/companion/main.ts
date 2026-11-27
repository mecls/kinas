// `kinas companion <rpc>` — the part of Kinas that runs on the VPS (ADRs 0022–0024; docs/external/vps.md). It is the one
// exception to the CLI's read-only rule besides `kinas crew setup`: it keeps its own state folder, and later writes a
// note into Firstmate's inbox (ADR 0022) and summaries to the cloud store (ADR 0023). On the Mac it is never run.

import { LINUX_RELEASES } from "@kinas/commands/crew-tools";
import { run } from "@kinas/context";
import { accessSync, constants, statfsSync } from "node:fs";
import { cpus, homedir, totalmem, userInfo } from "node:os";
import { join } from "node:path";
import { convexCloud, DEFAULT_LABEL, fileCloud, readCompanionEnv, type Cloud } from "./cloud.ts";
import { firstmate } from "./firstmate.ts";
import { herdrAt, herdrEnv, type Herdr } from "./herdr.ts";
import { githubReleases, rootReleases } from "./install.ts";
import { companionPath, companionPaths, nodeDir, type Paths } from "./paths.ts";
import { MAX_REQUEST_BYTES, rpc, versionIn } from "./rpc.ts";
import { lastReading, loop, readOnce, type Deps } from "./run.ts";
import type { SetupDeps } from "./setup.ts";
import { workerToken, type TokenDeps } from "./tokens.ts";
import { answersMayFlow, REFUSED_EXIT, workerLaunch, type WorkerDeps } from "./worker.ts";

export const COMPANION_USAGE = [
  "  companion run       (on the VPS) read Firstmate's home every 15 s into the companion's reading",
  "  companion rpc       (on the VPS) answer one request from Kinas on the Mac: JSON on stdin, JSON on stdout",
  "  companion worker-launch <task id> <folder> <claude's arguments…>",
  "                      (on the VPS, run by Kinas's claude wrapper) a Firstmate worker's sandbox settings, or why not",
];

/** Herdr's session the crew runs in on the VPS (ADR 0024). */
const SESSION = "default";

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** What the workers' sandbox check reads (worker.ts): this machine, its login, Node's folder and the companion's PATH. */
function workerDeps(paths: Paths): WorkerDeps {
  const home = homedir();
  const path = companionPath(home, executable);
  return { paths, uid: process.getuid?.() ?? -1, home, node: nodeDir(home, executable), arch: process.arch, which: (name) => Bun.which(name, { PATH: path }) };
}

/** GitHub's API for the App's tokens (ADR 0029). */
function tokenDeps(paths: Paths): TokenDeps {
  return { paths, uid: process.getuid?.() ?? -1, fetch: (url, init) => fetch(url, init), now: Date.now };
}

/**
 * The cloud store, when this machine has one (ADR 0023): `KINAS_COMPANION_CLOUD=file:<path>` (tests and the e2e), else
 * `~/.config/kinas/companion.env`. With neither, or with a file that is not private, nothing leaves the machine and the
 * log says why in a word.
 */
export function cloudOf(env: Record<string, string | undefined>, paths: Paths, home: string, uid: number, log: (line: string) => void): { cloud: Cloud; label: string } | null {
  const file = env.KINAS_COMPANION_CLOUD;
  if (file !== undefined && file.startsWith("file:") && paths.root !== null) return { cloud: fileCloud(file.slice("file:".length)), label: DEFAULT_LABEL };
  if (paths.root !== null) return null;
  const read = readCompanionEnv(join(home, ".config", "kinas", "companion.env"), uid);
  if ("error" in read) {
    if (read.error !== "no companion.env") log(`companion: no cloud (${read.error})`);
    return null;
  }
  return { cloud: convexCloud(read.url, read.secret), label: read.label };
}

function runDeps(paths: Paths): Deps {
  const path = companionPath(homedir(), executable);
  const workers = workerDeps(paths);
  return {
    paths,
    version: COMPANION_VERSION,
    // No note while any worker is not proven sandboxed (ADR 0027).
    fm: firstmate(paths.home, path, process.env, () => answersMayFlow(workers)),
    path,
    session: SESSION,
    clock: Date.now,
    // One line per event, never a fleet's words: journald keeps it.
    log: (line) => process.stderr.write(`${line}\n`),
    tokens: tokenDeps(paths),
    cloud: cloudOf(process.env, paths, homedir(), process.getuid?.() ?? -1, (line) => process.stderr.write(`${line}\n`)) ?? undefined,
  };
}

/** What setup's checks and installs run with (slice 4): this machine, its login, and the companion's own PATH. */
function setupDeps(paths: Paths, herdr: Herdr): SetupDeps {
  const home = homedir();
  const path = companionPath(home, executable);
  const env = herdrEnv(process.env, path);
  return {
    paths,
    home,
    user: userInfo().username,
    uid: process.getuid?.() ?? -1,
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    path,
    node: nodeDir(home, executable),
    run: (argv, o) => run(argv, { timeoutMs: o.timeoutMs, cwd: o.cwd, env }),
    herdr,
    releases: paths.releases === null ? githubReleases(LINUX_RELEASES) : rootReleases(paths.releases),
    which: (name) => Bun.which(name, { PATH: path }),
    machine: () => {
      let freeBytes: number | null = null;
      try {
        const s = statfsSync(home);
        freeBytes = s.bavail * s.bsize;
      } catch {
        freeBytes = null;
      }
      return { cores: cpus().length, memBytes: totalmem(), freeBytes };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    fetch: (url, init) => fetch(url, init),
  };
}

/** The CLI's version: the app's, which the release stamps into both. */
export const COMPANION_VERSION = "0.1.0";

async function readStdin(limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > limit) return "x".repeat(limit + 1);
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** How long `herdr --version` may take before hello says nothing about Herdr. */
const HERDR_VERSION_LIMIT_MS = 3_000;

/** `<path> --version`, a fixed argv with no shell and no PATH lookup; null when it is missing, slow or unreadable. */
async function versionOf(path: string): Promise<string | null> {
  const r = await run([path, "--version"], { timeoutMs: HERDR_VERSION_LIMIT_MS });
  return r.ok ? versionIn(r.stdout.slice(0, 200)) : null;
}

export async function companion(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "run" && rest.length === 0) {
    return loop(runDeps(companionPaths()));
  }
  if (sub === "rpc" && rest.length === 0) {
    const paths = companionPaths();
    const readNow = async () => {
      const prev = lastReading(paths);
      await readOnce(runDeps(paths), prev, prev?.companion.since ?? Date.now());
    };
    const herdr = herdrAt(paths.herdr, SESSION, companionPath(homedir(), executable));
    const reader = runDeps(paths);
    const deps = { paths, version: COMPANION_VERSION, herdrVersion: () => versionOf(paths.herdr), readNow, now: Date.now, herdr, setup: setupDeps(paths, herdr), fm: reader.fm, log: reader.log };
    const { reply, exit } = await rpc(await readStdin(MAX_REQUEST_BYTES), deps);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return exit;
  }
  if (sub === "worker-launch" && rest.length >= 2) {
    const [id, cwd, ...argv] = rest as [string, string, ...string[]];
    const paths = companionPaths();
    const out = workerLaunch(workerDeps(paths), process.env, id, cwd, argv);
    if ("refused" in out) {
      process.stderr.write(`kinas: ${out.refused}\n`);
      return REFUSED_EXIT;
    }
    // ADR 0029: the task's own GitHub token, or the worker doesn't start.
    const token = await workerToken(tokenDeps(paths), id, cwd);
    if ("refused" in token) {
      process.stderr.write(`kinas: ${token.refused}\n`);
      return REFUSED_EXIT;
    }
    process.stdout.write(`${out.sha256}\n${out.file}\n${out.tmp}\n`);
    return 0;
  }
  process.stderr.write(`usage:\n${COMPANION_USAGE.join("\n")}\n`);
  return 64;
}
