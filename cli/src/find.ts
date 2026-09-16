// Finding a file by name under the projects folder (reader PRD R11, amended 2026-09-16): `kinas open reader.md` and
// `kinas open 0008_funnel_stage.sql` work from any folder, so a name that is not a path is searched for. Pure apart
// from reading directories, and bounded, so a big tree cannot make the CLI hang.
//
// Names only, never contents: whether a match is something the reader can open is judged later, by `at()` in
// open.ts. So a search can offer a file that then refuses, which is the honest order — finding it is cheap, and
// reading every candidate to filter the list would not be.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Folders a search never enters: build output, caches and anything hidden. */
export const SKIPPED = new Set(["node_modules", "target", "dist", "build", "Pods", ".git"]);
export const MAX_DEPTH = 8;
/** A cap on the whole walk, so a huge tree still answers quickly. */
export const MAX_ENTRIES = 40_000;

export interface Match {
  path: string;
  /** Last modified, so the newest match can lead the list. */
  mtimeMs: number;
}

/**
 * The names a bare argument may mean.
 *
 * An explicit extension is taken as given, so `0008_funnel_stage.sql` searches for exactly that and is not
 * expanded into `.md` candidates that do not exist. Without one, `reader` still means `reader.md` or `reader.mdx`
 * — the reader's common case — plus the bare name itself, which is what makes `kinas open Dockerfile` and
 * `kinas open Makefile` work. Lowercased throughout, because `findByName` compares against a lowercased entry.
 */
export function candidateNames(arg: string): string[] {
  const name = arg.replace(/^\.\//, "").toLowerCase();
  if (name.includes("/")) return [];
  if (/\.[^./]+$/.test(name)) return [name];
  return [`${name}.md`, `${name}.mdx`, name];
}

/**
 * Every markdown file under `root` whose name matches, newest first.
 *
 * @param arg a bare file name, with or without its extension
 */
export function findByName(root: string, arg: string, limit = 20): Match[] {
  const names = candidateNames(arg);
  if (names.length === 0) return [];
  const matches: Match[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES || matches.length >= limit) return;
    // Inferred, not annotated: `ReturnType<typeof readdirSync>` picks the Buffer overload, whose names are not strings.
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen > MAX_ENTRIES || matches.length >= limit) return;
      seen++;
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.isFile() && names.includes(entry.name.toLowerCase())) {
        try {
          matches.push({ path, mtimeMs: statSync(path).mtimeMs });
        } catch {
          // Gone between reading the folder and asking about it.
        }
      }
    }
  };
  walk(root, 0);
  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
