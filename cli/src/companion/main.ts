// `kinas companion <rpc>` — the part of Kinas that runs on the VPS (ADRs 0021–0023; docs/external/vps.md). It is the one
// exception to the CLI's read-only rule besides `kinas crew setup`: it keeps its own state folder, and later writes a
// note into Firstmate's inbox (ADR 0022) and summaries to the cloud store (ADR 0023). On the Mac it is never run.

import { companionPaths } from "./paths.ts";
import { MAX_REQUEST_BYTES, rpc } from "./rpc.ts";

export const COMPANION_USAGE = ["  companion rpc       (on the VPS) answer one request from Kinas on the Mac: JSON on stdin, JSON on stdout"];

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

export async function companion(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "rpc" && rest.length === 0) {
    const { reply, exit } = await rpc(await readStdin(MAX_REQUEST_BYTES), { paths: companionPaths(), version: COMPANION_VERSION });
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return exit;
  }
  process.stderr.write(`usage:\n${COMPANION_USAGE.join("\n")}\n`);
  return 64;
}
