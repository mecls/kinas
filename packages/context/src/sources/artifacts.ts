// Artifacts: the markdown files that define a project, found by convention and listed by path, title and modified
// time — never their contents, so an agent loads exactly what it needs.
//
//   AGENTS.md (any folder) · README.md (project root) · anything under docs/, plans/ or specs/ ·
//   any file named con-* (conventions), spec-*, plan-* or epic-*

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { run, splitZ } from "../exec.ts";
import type { ArtifactRow } from "../packet.ts";

const TOP_DIRS = ["docs/", "plans/", "specs/"];
const PREFIXES = /^(con|spec|plan|epic)-/;
/** Newest first when a project has more; the packet says how many were left out. */
export const MAX_ARTIFACTS_PER_PROJECT = 60;

export function isArtifact(rel: string): boolean {
  if (!/\.mdx?$/i.test(rel)) return false;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return base === "AGENTS.md" || rel === "README.md" || TOP_DIRS.some((d) => rel.startsWith(d)) || PREFIXES.test(base);
}

/** The first ATX heading after any front matter; null when there is none in the first 8 KB. */
export function firstHeading(text: string): string | null {
  let lines = text.split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) lines = lines.slice(end + 1);
  }
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function readTitle(path: string): Promise<string | null> {
  try {
    return firstHeading(await Bun.file(path).slice(0, 8192).text());
  } catch {
    return null;
  }
}

export interface ArtifactsReading {
  rows: ArtifactRow[];
  /** Artifacts left out per project name, when over the cap. */
  omitted: Map<string, number>;
}

export async function readArtifacts(project: { name: string; path: string }): Promise<{ rows: ArtifactRow[]; omitted: number }> {
  // Tracked and untracked-but-not-ignored markdown, from the index and the exclude rules — no porcelain.
  const listed = await run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md", "*.mdx"], {
    cwd: project.path,
    timeoutMs: 5_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
  });
  if (!listed.ok) return { rows: [], omitted: 0 };

  const paths = [...new Set(splitZ(listed.stdout))].filter(isArtifact);
  const rows = (
    await Promise.all(
      paths.map(async (rel): Promise<ArtifactRow | null> => {
        const abs = join(project.path, rel);
        const st = await stat(abs).catch(() => null);
        if (!st?.isFile()) return null;
        return { project: project.name, path: rel, title: await readTitle(abs), modified_at: Math.floor(st.mtimeMs) };
      }),
    )
  ).filter((r): r is ArtifactRow => r !== null);

  const kept = rows.sort((a, b) => b.modified_at - a.modified_at).slice(0, MAX_ARTIFACTS_PER_PROJECT);
  // Code-point order, like git: stable across machines and locales.
  kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { rows: kept, omitted: rows.length - kept.length };
}

export async function readAllArtifacts(projects: { name: string; path: string; error: string | null }[]): Promise<ArtifactsReading> {
  const readings = await Promise.all(projects.filter((p) => !p.error).map(async (p) => [p.name, await readArtifacts(p)] as const));
  return {
    rows: readings.flatMap(([, r]) => r.rows),
    omitted: new Map(readings.filter(([, r]) => r.omitted > 0).map(([name, r]) => [name, r.omitted])),
  };
}
