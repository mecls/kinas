// `kinas companion rpc` (ADR 0024): one request on stdin, one JSON reply on stdout, then exit — 0 answered, 1 failed,
// 2 refused. The Mac's door (app/src-tauri/src/remote.rs) is the only caller. Slice 1: `hello` and `bundle`, which hands
// back the latest reading as the run loop left it (slice 2 writes it; until then a test or the e2e's fake VPS does).

import { readFile } from "node:fs/promises";
import type { Paths } from "./paths.ts";
import { validate, type Request } from "./validate.ts";

export const RPC_VERSION = 1;
/** A request is a few hundred bytes; anything past this is not one. */
export const MAX_REQUEST_BYTES = 64 * 1024;

export interface RpcDeps {
  paths: Paths;
  version: string;
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
    case "hello":
      return { reply: { v: RPC_VERSION, companion: { version: deps.version } }, exit: 0 };
    case "bundle":
      return bundle(deps);
    case "refresh":
      // Slice 2 runs a reading now; until then there is nothing to run.
      return { reply: { v: RPC_VERSION, refreshed: false }, exit: 0 };
  }
}

async function bundle(deps: RpcDeps): Promise<RpcResult> {
  let text: string;
  try {
    text = await readFile(deps.paths.reading, "utf8");
  } catch {
    return { reply: { v: RPC_VERSION, error: "no-reading" }, exit: 1 };
  }
  try {
    const reading = JSON.parse(text) as { v?: unknown };
    if (reading.v !== RPC_VERSION) return { reply: { v: RPC_VERSION, error: "bad-reading" }, exit: 1 };
    return { reply: reading, exit: 0 };
  } catch {
    return { reply: { v: RPC_VERSION, error: "bad-reading" }, exit: 1 };
  }
}
