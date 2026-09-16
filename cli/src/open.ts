// `kinas open` (PRD R2–R7, R11–R17): resolve the path the way the app will judge it, then hand it to the running app
// over <data dir>/kinas.sock. Resolution touches only realpath and stat, so nothing is ever created or written; the
// app checks every path again on its side, because any local process can write to the socket.

import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import net from "node:net";
import { isAbsolute, resolve } from "node:path";
import { findByName } from "./find.ts";

export const OPEN_EXIT = { ok: 0, error: 1, notMarkdown: 65, noInput: 66, outside: 77 } as const;

/** How long the CLI waits for the app to answer, and for `--launch` to bring the socket up (R12, R14). */
export const ANSWER_TIMEOUT_MS = 2000;
export const LAUNCH_TIMEOUT_MS = 15_000;
const LAUNCH_POLL_MS = 100;

export type Target =
  | { ok: true; path: string; kind: "file" | "dir" }
  /** Several files carry that name: the reader shows a picker and opens nothing until Miguel chooses (R1b). */
  | { ok: true; pick: string[] }
  | { ok: false; exit: number; message: string };

export function isMarkdown(path: string): boolean {
  return /\.mdx?$/i.test(path);
}

/** `real` is `realRoot` or inside it; the trailing `/` keeps `SintraLabs-old` out of `SintraLabs` (R2). */
export function insideRoot(real: string, realRoot: string): boolean {
  const base = realRoot.replace(/\/+$/, "");
  return real === realRoot || real === base || real.startsWith(`${base}/`);
}

export function realRoot(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return resolve(root);
  }
}

/**
 * Where an argument points (R1b, amended 2026-09-16): a path in the shell's folder, else the same path under the
 * projects folder, else a markdown file of that name anywhere under it. So `kinas open reader.md` works from any
 * folder, and nothing inside the projects folder ever needs a flag.
 */
export function resolveTarget(arg: string, opts: { cwd: string; root: string; anywhere: boolean }): Target {
  const root = realRoot(opts.root);
  const tries = [resolve(opts.cwd, arg), ...(isAbsolute(arg) ? [] : [resolve(root, arg)])];
  for (const candidate of tries) {
    const found = at(candidate, root, opts.anywhere);
    if (found) return found;
  }
  // Not a path anywhere: search the projects folder by name.
  const matches = findByName(root, arg);
  if (matches.length === 1) return at(matches[0]!.path, root, opts.anywhere) ?? missing(arg, root);
  if (matches.length > 1) return { ok: true, pick: matches.map((m) => m.path) };
  return missing(arg, root);
}

function missing(arg: string, root: string): Target {
  return isAbsolute(arg) || arg.includes("/")
    ? { ok: false, exit: OPEN_EXIT.noInput, message: `kinas open: no such file: ${arg.startsWith("/") ? arg : resolve(root, arg)}` }
    : { ok: false, exit: OPEN_EXIT.noInput, message: `kinas open: no markdown file named ${arg} under ${root}` };
}

/** One candidate path, or null when nothing is there (so the next step may try). */
function at(candidate: string, root: string, anywhere: boolean): Target | null {
  let real: string;
  try {
    real = realpathSync.native(candidate);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return { ok: false, exit: OPEN_EXIT.error, message: `kinas open: could not read ${candidate}: ${(e as Error).message}` };
  }
  const stat = statSync(real);
  const kind = stat.isDirectory() ? "dir" : "file";
  // Judged on the real path: a `plan.md` link to a `.txt` is not markdown (R3).
  if (kind === "file" && (!stat.isFile() || !isMarkdown(real))) {
    return { ok: false, exit: OPEN_EXIT.notMarkdown, message: `kinas open: ${real} is not a .md or .mdx file` };
  }
  if (!anywhere && !insideRoot(real, root)) {
    return { ok: false, exit: OPEN_EXIT.outside, message: `kinas open: ${real} is outside ${root}; add --anywhere to ask Kinas to open it` };
  }
  return { ok: true, path: real, kind };
}

export type OpenRequest =
  | { v: 1; op: "open"; path: string; anywhere: boolean }
  | { v: 1; op: "reopen" }
  /** Several matches by name: the app shows a picker (R1b). */
  | { v: 1; op: "pick"; paths: string[] };

export type AppResponse =
  | { ok: true; result: "opened" | "confirm"; path: string }
  | { ok: true; result: "pick"; paths: string[] }
  | { ok: false; code: string; error: string };

export type Answer = { kind: "down" } | { kind: "silent" } | { kind: "failed"; message: string } | { kind: "answer"; body: AppResponse };

/** No listener at the path: the app is not running (a stale socket file refuses, a plain file is not a socket). */
const DOWN = new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK"]);

function parseResponse(line: string): Answer {
  try {
    const body = JSON.parse(line) as AppResponse;
    if (body && typeof body === "object" && typeof body.ok === "boolean") return { kind: "answer", body };
  } catch {
    // Falls through to the failure below.
  }
  return { kind: "failed", message: "kinas open: Kinas sent an answer this CLI does not understand" };
}

/** One request line, one response line (R17), over `node:net` like the Herdr source in @kinas/context. */
export function ask(socketPath: string, request: OpenRequest, timeoutMs = ANSWER_TIMEOUT_MS): Promise<Answer> {
  return new Promise((done) => {
    let buffer = "";
    let settled = false;
    const socket = net.createConnection({ path: socketPath });
    const finish = (answer: Answer) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(timeoutMs, () => finish({ kind: "silent" }));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) finish(parseResponse(buffer.slice(0, newline)));
    });
    socket.on("end", () => finish(buffer.trim() ? parseResponse(buffer) : { kind: "silent" }));
    socket.on("error", (e: NodeJS.ErrnoException) =>
      finish(DOWN.has(e.code ?? "") ? { kind: "down" } : { kind: "failed", message: `kinas open: could not reach Kinas: ${e.message}` }),
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `--launch` (R14): start Kinas, then send the request as soon as the socket answers. Null when it never came up.
 * `start` is injectable so tests never launch the real app.
 */
export async function launchAndAsk(
  socketPath: string,
  request: OpenRequest,
  opts: { timeoutMs?: number; start?: () => boolean } = {},
): Promise<Answer | null> {
  const start = opts.start ?? (() => spawnSync("/usr/bin/open", ["-b", "ai.sintralabs.kinas"]).status === 0);
  if (!start()) return null;
  const deadline = Date.now() + (opts.timeoutMs ?? LAUNCH_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const answer = await ask(socketPath, request);
    if (answer.kind !== "down") return answer;
    await sleep(LAUNCH_POLL_MS);
  }
  return null;
}

export interface Outcome {
  exit: number;
  stdout: string | null;
  stderr: string | null;
}

/** What `kinas open` prints and returns for the app's answer (R7, R12, R13). `path` is null for a reopen. */
export function outcome(answer: Answer, ctx: { path: string | null; tty: boolean }): Outcome {
  switch (answer.kind) {
    case "answer": {
      const body = answer.body;
      if (body.ok && body.result === "pick") {
        // Every match on stdout, so a script can see them; the reader waits for a click.
        return { exit: OPEN_EXIT.ok, stdout: body.paths.join("\n"), stderr: `Kinas is asking which of the ${body.paths.length} files you mean` };
      }
      if (body.ok) {
        return { exit: OPEN_EXIT.ok, stdout: body.path, stderr: body.result === "confirm" ? "Kinas is asking whether to open it" : null };
      }
      const exit =
        body.code === "missing" || body.code === "empty_history"
          ? OPEN_EXIT.noInput
          : body.code === "not_markdown"
            ? OPEN_EXIT.notMarkdown
            : body.code === "outside"
              ? OPEN_EXIT.outside
              : OPEN_EXIT.error;
      return { exit, stdout: null, stderr: body.error };
    }
    case "silent":
      return { exit: OPEN_EXIT.error, stdout: null, stderr: "kinas open: Kinas did not answer" };
    case "failed":
      return { exit: OPEN_EXIT.error, stdout: null, stderr: answer.message };
    case "down":
      if (ctx.path === null) return { exit: OPEN_EXIT.noInput, stdout: null, stderr: "kinas open: Kinas is not running, so there is no last file" };
      return { exit: OPEN_EXIT.ok, stdout: ctx.path, stderr: ctx.tty ? "Kinas is not running; add --launch to start it" : null };
  }
}
