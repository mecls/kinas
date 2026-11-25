// `kinas companion <rpc>` — the part of Kinas that runs on the VPS (ADRs 0022–0024; docs/external/vps.md). It is the one
// exception to the CLI's read-only rule besides `kinas crew setup`: it keeps its own state folder, and later writes a
// note into Firstmate's inbox (ADR 0022) and summaries to the cloud store (ADR 0023). On the Mac it is never run.

import { run } from "@kinas/context";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { firstmate } from "./firstmate.ts";
import { herdrAt } from "./herdr.ts";
import { companionPath, companionPaths, type Paths } from "./paths.ts";
import { MAX_REQUEST_BYTES, rpc, versionIn } from "./rpc.ts";
import { lastReading, loop, readOnce, type Deps } from "./run.ts";

export const COMPANION_USAGE = [
  "  companion run       (on the VPS) read Firstmate's home every 15 s into the companion's reading",
  "  companion rpc       (on the VPS) answer one request from Kinas on the Mac: JSON on stdin, JSON on stdout",
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

function runDeps(paths: Paths): Deps {
  const path = companionPath(homedir(), executable);
  return {
    paths,
    version: COMPANION_VERSION,
    fm: firstmate(paths.home, path),
    path,
    session: SESSION,
    clock: Date.now,
    // One line per event, never a fleet's words: journald keeps it.
    log: (line) => process.stderr.write(`${line}\n`),
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
    const deps = { paths, version: COMPANION_VERSION, herdrVersion: () => versionOf(paths.herdr), readNow, now: Date.now, herdr };
    const { reply, exit } = await rpc(await readStdin(MAX_REQUEST_BYTES), deps);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return exit;
  }
  process.stderr.write(`usage:\n${COMPANION_USAGE.join("\n")}\n`);
  return 64;
}
