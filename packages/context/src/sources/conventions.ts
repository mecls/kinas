// Conventions: the org-level rules every agent follows — the hub's AGENTS.md and every con-*.md under the hub,
// printed in full in the agent packet because these are the rails.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ConventionDoc } from "../packet.ts";
import { SourceError } from "../source.ts";
import { firstHeading } from "./artifacts.ts";

const SKIP_DIRS = new Set(["node_modules", "target", "dist", "build", "vendor", "Library"]);
const MAX_DEPTH = 4;
/** One convention larger than this is cut, and says so. */
export const MAX_CONVENTION_BYTES = 64 * 1024;

async function findConventionFiles(hub: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && /^con-.*\.md$/i.test(e.name)) found.push(join(dir, e.name));
    }
    if (depth >= MAX_DEPTH) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
        .map((e) => walk(join(dir, e.name), depth + 1)),
    );
  }
  await walk(hub, 0);
  return found.sort();
}

export async function readConventions(hub: string): Promise<ConventionDoc[]> {
  if (!existsSync(hub)) throw new SourceError(`no hub folder at ${hub}`);
  const agents = join(hub, "AGENTS.md");
  const files = [...(existsSync(agents) ? [agents] : []), ...(await findConventionFiles(hub))];
  if (files.length === 0) throw new SourceError(`no AGENTS.md or con-*.md under ${hub}`);

  return Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(file);
      const truncated = bytes.byteLength > MAX_CONVENTION_BYTES;
      const body = (truncated ? bytes.subarray(0, MAX_CONVENTION_BYTES) : bytes).toString("utf8");
      return { path: relative(hub, file), title: firstHeading(body), body, truncated };
    }),
  );
}
