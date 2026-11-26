// `kinas companion rpc` (ADR 0024): one request on stdin, one JSON reply on stdout, then exit — 0 answered, 1 failed,
// 2 refused. The Mac's door (app/src-tauri/src/remote.rs) is the only caller. `hello`; `bundle`, the latest reading as
// the run loop left it plus the fleet ledger since the Mac's cursor; `refresh`, a reading now; `view`, Herdr's view now;
// and the Herdr actions
// (actions.ts) — `launch-first-mate`, `focus`, `open-workspace` — whose outcome is `{ done }` or `{ cannot }`, exit 0
// either way: "not there" is an answer the Mac puts in words, and a non-zero exit would lose it at the door. Since
// slice 4, `hello` carries setup's checks (setup.ts) and the client folders already cloned, and `install` (install.ts)
// answers the same way. Since slice 6, `answer` delivers the captain's answer as a note in Firstmate's inbox (answer.ts),
// and `bundle` carries what became of each answer, never its words.

import { readFile } from "node:fs/promises";
import { focusWorkspace, launchFirstMate, openWorkspace, viewNow } from "./actions.ts";
import { answersForBundle, deliver } from "./answer.ts";
import type { Firstmate } from "./firstmate.ts";
import type { Herdr } from "./herdr.ts";
import { install } from "./install.ts";
import type { Paths } from "./paths.ts";
import { ledgerSince } from "./run.ts";
import { checks, folders, type SetupDeps } from "./setup.ts";
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
  /** herdr.ts's runner on the `default` session, for the actions. */
  herdr: Herdr;
  /** What setup's checks and installs run with (slice 4). */
  setup: SetupDeps;
  /** Firstmate's runner, with the note's sandbox gate (ADR 0027), for `answer` (slice 6). */
  fm: Firstmate;
  /** One line per event, never an answer's words or a task's name. */
  log: (line: string) => void;
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
      const [herdr, rows] = await Promise.all([deps.herdrVersion(), checks(deps.setup)]);
      return {
        reply: {
          v: RPC_VERSION,
          companion: { version: deps.version },
          herdr: herdr === null ? null : { version: herdr },
          // Slice 4: the rows, the client folders already in the projects folders (names only), and the login's name for the
          // linger command the captain runs.
          checks: rows,
          folders: [...new Set(deps.paths.projectRoots.flatMap((r) => folders(r)))].sort(),
          user: deps.setup.user,
        },
        exit: 0,
      };
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
    case "view":
      return { reply: { v: RPC_VERSION, ...(await viewNow(deps)) }, exit: 0 };
    case "launch-first-mate":
      return { reply: { v: RPC_VERSION, ...(await launchFirstMate(deps)) }, exit: 0 };
    case "focus":
      return { reply: { v: RPC_VERSION, ...(await focusWorkspace(deps, request.workspace)) }, exit: 0 };
    case "open-workspace":
      return { reply: { v: RPC_VERSION, ...(await openWorkspace(deps, request.folder, request.label)) }, exit: 0 };
    case "answer":
      // Every outcome and refusal is an answer the Mac puts in words: exit 0, since the door drops a reply on any other.
      try {
        const reply = await deliver(
          { paths: deps.paths, fm: deps.fm, clock: deps.now, log: deps.log },
          { task: request.task, key: request.key, words: request.words, requestId: request.request_id, from: request.from },
        );
        return { reply: { v: RPC_VERSION, ...reply }, exit: 0 };
      } catch {
        deps.log("companion: answer failed (its record couldn't be written)");
        return { reply: { v: RPC_VERSION, error: "answer-failed" }, exit: 1 };
      }
    case "install": {
      const { verb: _, ...req } = request;
      return { reply: { v: RPC_VERSION, ...(await install(req, deps.setup)) }, exit: 0 };
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
    // `answers`: what became of each answer (slice 6, point 7), from the companion's own record, without the words.
    return { reply: { ...reading, served_at: deps.now(), ledger: ledgerSince(deps.paths.home, cursor), answers: answersForBundle(deps.paths) }, exit: 0 };
  } catch {
    return { reply: { v: RPC_VERSION, error: "bad-reading" }, exit: 1 };
  }
}
