// `kinas companion rpc` (ADR 0024): one request on stdin, one JSON reply on stdout, then exit — 0 answered, 1 failed,
// 2 refused. The Mac's door (app/src-tauri/src/remote.rs) is the only caller. `hello`; `bundle`, the latest reading as
// the run loop left it plus the fleet ledger since the Mac's cursor; `refresh`, a reading now.

import { readFile } from "node:fs/promises";
import type { Paths } from "./paths.ts";
import { ledgerSince } from "./run.ts";
import { validate, type Cursor, type Request } from "./validate.ts";

export const RPC_VERSION = 1;
/** A request is a few hundred bytes; anything past this is not one. */
export const MAX_REQUEST_BYTES = 64 * 1024;

export interface RpcDeps {
  paths: Paths;
  version: string;
  /** `herdr --version` at `paths.herdr`, its first `x.y.z`; null when it is not there or says nothing readable. */
  herdrVersion: () => Promise<string | null>;
  /** One reading now (`run.ts` readOnce), for `refresh`. */
  readNow: () => Promise<void>;
  now: () => number;
}

/** The first `major.minor.patch` in a version line (`herdr 0.9.5` → `0.9.5`), as the Mac's `tools::version_in`. */
export function versionIn(text: string): string | null {
  return /(?<![0-9.])(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

export interface RpcResult {
  reply: unknown;
  exit: 0 | 1 | 2;
}

export async function rpc(stdin: string, deps: RpcDeps): Promise<RpcResult> {
  if (stdin.length > MAX_REQUEST_BYTES) return { reply: { v: RPC_VERSION, error: "refused", why: "the request is too large" }, exit: 2 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch {
    return { reply: { v: RPC_VERSION, error: "refused", why: "the request is not JSON" }, exit: 2 };
  }
  const request = validate(parsed);
  if ("refused" in request) return { reply: { v: RPC_VERSION, error: "refused", why: request.refused }, exit: 2 };
  return answer(request, deps);
}

async function answer(request: Request, deps: RpcDeps): Promise<RpcResult> {
  switch (request.verb) {
    case "hello": {
      // The machine's Herdr beside the Mac's (build spec §17, 2026-11-24 #4): the Reachable row says when they differ.
      const herdr = await deps.herdrVersion();
      return { reply: { v: RPC_VERSION, companion: { version: deps.version }, herdr: herdr === null ? null : { version: herdr } }, exit: 0 };
    }
    case "bundle":
      return bundle(deps, request.cursor);
    case "refresh":
      try {
        await deps.readNow();
        return { reply: { v: RPC_VERSION, refreshed: true }, exit: 0 };
      } catch {
        return { reply: { v: RPC_VERSION, error: "reading-failed" }, exit: 1 };
      }
  }
}

async function bundle(deps: RpcDeps, cursor: Cursor | null): Promise<RpcResult> {
  let text: string;
  try {
    text = await readFile(deps.paths.reading, "utf8");
  } catch {
    return { reply: { v: RPC_VERSION, error: "no-reading" }, exit: 1 };
  }
  try {
    const reading = JSON.parse(text) as { v?: unknown };
    if (reading.v !== RPC_VERSION) return { reply: { v: RPC_VERSION, error: "bad-reading" }, exit: 1 };
    // The ledger is read now, from the Mac's own cursor: the reading on disk is shared, the cursor is the Mac's.
    // `served_at`: this machine's clock now, so the Mac reads the heartbeat's age on one clock, never across two.
    return { reply: { ...reading, served_at: deps.now(), ledger: ledgerSince(deps.paths.home, cursor) }, exit: 0 };
  } catch {
    return { reply: { v: RPC_VERSION, error: "bad-reading" }, exit: 1 };
  }
}
