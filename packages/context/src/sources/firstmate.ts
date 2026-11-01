// Crew: Firstmate's fleet through its own canonical reader, `bin/fm-fleet-snapshot.sh --json` (contract
// `fm-fleet-snapshot.v1`). Firstmate's rule is that views render that output rather than parse its state files, so
// Kinas does the same. The snapshot never mutates backlog or task state; its only write is Firstmate's own
// observational cache of remote secondmate summaries. Kinas writes nothing into Firstmate.

import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { run } from "../exec.ts";
import type { Crew, CrewBrief, CrewHold, CrewReport, CrewTask } from "../packet.ts";
import { SourceError, SourceTimeout } from "../source.ts";

export const FLEET_SCHEMA = "fm-fleet-snapshot.v1";
export const FIRSTMATE_TIMEOUT_MS = 20_000;
const REPORTS_SHOWN = 5;

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

export async function firstLine(path: string): Promise<string | null> {
  try {
    const text = await Bun.file(path).slice(0, 4096).text();
    return text.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l !== "") ?? null;
  } catch {
    return null;
  }
}

/**
 * A path Firstmate reported, relative to its home or absolute, only when it stays lexically inside the home — the app's
 * `under_home` (crew/mod.rs). Under the home Kinas reads a report's first line for the packet and nothing outside it
 * (ADR 0019); the path is what a worker wrote, so a `..` or a path elsewhere is not followed.
 */
export function underHome(home: string, reported: string): string | null {
  const raw = isAbsolute(reported) ? reported : `${home}/${reported}`;
  if (raw.split("/").includes("..")) return null;
  const path = resolve(raw);
  const root = resolve(home);
  return path === root || path.startsWith(`${root}/`) ? path : null;
}

/**
 * A scout report's first line, read only when the report is inside the home on disk as well as on paper: `underHome`
 * judges the path as written, and a link inside the home to a file outside it is not followed — the app opens a report
 * only through the reader, which judges the real path (ADR 0009, 0019). A regular file only, as a missing one is not
 * listed: a worker can leave a FIFO at the path, and its read never returns — nor does any deadline cover the reports.
 * `id` defaults to the path.
 */
export async function readReport(home: string, reported: string, id: string | null): Promise<CrewReport | null> {
  const path = underHome(home, reported);
  if (path === null) return null;
  const [real, realHome] = await Promise.all([realpath(path).catch(() => null), realpath(home).catch(() => resolve(home))]);
  if (real === null || !(real === realHome || real.startsWith(`${realHome}/`))) return null;
  const st = await stat(real).catch(() => null);
  if (!st?.isFile()) return null;
  return { id: id ?? path, path, first_line: await firstLine(real), modified_at: Math.floor(st.mtimeMs) };
}

/** The fleet snapshot's fields Kinas shows, its reports read only under `home`. Anything else stays Firstmate's business. */
export async function crewFromSnapshot(snapshot: unknown, now: number, home: string): Promise<Crew> {
  const s = (snapshot ?? {}) as Json;
  const schema = str(s.schema);
  if (schema !== FLEET_SCHEMA) throw new SourceError(`firstmate: unsupported snapshot contract ${schema ?? "(none)"}, expected ${FLEET_SCHEMA}`);

  const records = list((s.backlog as Json | undefined)?.records).filter((r) => r.structured === true && str(r.id));
  const tasks = list(s.tasks);
  const taskById = new Map(tasks.map((t) => [str(t.id), t]));

  const inFlight: CrewTask[] = records
    .filter((r) => r.state === "in_flight")
    .map((r) => {
      const id = str(r.id)!;
      const t = taskById.get(id);
      const current = (t?.current_state ?? {}) as Json;
      const worktree = ((t?.paths as Json | undefined)?.worktree ?? {}) as Json;
      return {
        id,
        title: str(r.title) ?? id,
        project: str(t?.project) ?? str(r.repo),
        kind: str(t?.kind) ?? str(r.kind),
        state: t ? (str(current.state) ?? "unknown") : "no task metadata",
        worktree: str(worktree.path),
      };
    });

  const blocked: CrewHold[] = records.filter((r) => r.captain_actionable === true).map((r) => ({ id: str(r.id)!, title: str(r.title) ?? str(r.id)!, reason: str(r.hold_reason) }));
  for (const t of tasks) {
    const id = str(t.id);
    const hints = (t.hints ?? {}) as Json;
    if (!id || hints.pending_decision !== true || blocked.some((b) => b.id === id)) continue;
    const row = records.find((r) => r.id === id);
    blocked.push({ id, title: str(row?.title) ?? id, reason: str(hints.last_event_text) });
  }

  const intake: CrewBrief[] = records
    .filter((r) => r.state === "queued" && r.captain_actionable !== true)
    .map((r) => ({ id: str(r.id)!, title: str(r.title) ?? str(r.id)!, repo: str(r.repo), filed: str(r.since) }));

  const reports: CrewReport[] = (
    await Promise.all(
      list(s.scout_reports).map(async (r): Promise<CrewReport | null> => {
        const reported = str(r.path);
        return reported === null ? null : readReport(home, reported, str(r.id));
      }),
    )
  )
    .filter((r): r is CrewReport => r !== null)
    .sort((a, b) => b.modified_at - a.modified_at)
    .slice(0, REPORTS_SHOWN);

  return {
    home: str(s.fm_home) ?? "",
    schema,
    generated: str(s.generated) ?? new Date(now).toISOString(),
    in_flight: inFlight,
    intake,
    blocked,
    reports,
  };
}

/**
 * A crew process's environment (the first mate's PRD rule 29): the caller's, with `FM_HOME` set and every `HERDR*`
 * variable removed — a `kinas context` run inside a Herdr pane must not point Firstmate at that pane's session. The
 * CLI runs from the captain's shell, so its `PATH` is the login one already; stdin is closed and the run has a limit.
 */
export function crewEnv(env: Record<string, string | undefined>, home: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !k.toUpperCase().startsWith("HERDR")) out[k] = v;
  out.FM_HOME = home;
  return out;
}

export async function readCrew(home: string, now: number, timeoutMs = FIRSTMATE_TIMEOUT_MS): Promise<Crew> {
  const script = join(home, "bin/fm-fleet-snapshot.sh");
  if (!existsSync(script)) throw new SourceError(`firstmate: not installed (no ${script})`);
  if (!existsSync(join(home, "data/backlog.md")) && !existsSync(join(home, "state"))) throw new SourceError(`firstmate: no fleet state yet in ${home}`);

  const result = await run(["bash", script, "--json"], { cwd: home, timeoutMs, env: crewEnv(process.env, home) });
  if (result.timedOut) throw new SourceTimeout(`firstmate: the fleet snapshot took longer than ${timeoutMs / 1000} s`);
  if (!result.ok) {
    const why = result.error ?? (result.stderr.trim().split("\n").pop() || `exit ${result.code}`);
    throw new SourceError(`firstmate: the fleet snapshot failed (${why})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new SourceError("firstmate: the fleet snapshot is not JSON");
  }
  return crewFromSnapshot(parsed, now, home);
}
