// The Linux machine's own readings for the Mac's Usage page (build spec §12 slice 5.1; PRD §2 rule 8): Claude Code's
// plan hand-off, the host's CPU, memory and disk, and token counts from this machine's transcripts. Only Claude Code's
// own hand-off and numbers cross; a transcript's text never leaves this machine. The Mac keeps its parsers: the
// hand-off is passed verbatim with the two times `claude_plan.rs` decides freshness from, read here because the
// transcript is here, and the counts are the same `recount` as `scripts/check-usage.ts`'s.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { lisbonDate, recount, type UsageRow } from "@kinas/context";
import { regularBytes } from "./plants.ts";

/** The statusline hand-off on this machine (`docs/external/claude-statusline-hook.md`, amended 2026-11-17). */
export const PLAN_FILE = "claude-rate-limits.json";
/** The hand-off is a few hundred bytes; anything past this is not one. */
export const PLAN_LIMIT = 64 * 1024;
/** As `claude_plan.rs`'s `TAIL_BYTES`: the session transcript's last assistant line is found in its last 512 KiB. */
export const TAIL_BYTES = 512 * 1024;
/** The token counts are recounted at most this often (build spec §11 flow B). */
export const RECOUNT_GAP_MS = 5 * 60_000;
/** Days of counts the bundle carries; older days keep what the Mac stored. */
export const USAGE_DAYS = 31;

const GIB = 1024 * 1024 * 1024;
const DAY_MS = 86_400_000;

export interface PlanOut {
  /** The hand-off file, verbatim: the Mac's `parse_handoff` reads it. */
  text: string;
  /** The file's modification time, for a hand-off without `captured_at`. */
  file_at: number;
  /** The session transcript's last assistant line here, or null: the Mac takes the earlier of it and `captured_at`. */
  last_assistant_at: number | null;
}

/** The `hosts` row's own fields (`readers/host.rs`), in GiB. */
export interface HostOut {
  /** Null on the first reading, or when the counters didn't move: a share needs two samples. */
  cpu_pct: number | null;
  mem_used_gb: number;
  mem_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_available_gb: number;
}

export interface CpuSample {
  busy: number;
  total: number;
}

export interface UsageOut {
  counted_at: number;
  rows: UsageRow[];
}

const isSessionId = (id: string) => id.length > 0 && id.length <= 64 && /^[0-9A-Fa-f-]+$/.test(id);
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/** The hand-off as found, or null when there is none (or it is a link, too big, or not a regular file). */
export function planNow(state: string, claudeHome: string): PlanOut | null {
  const file = join(state, PLAN_FILE);
  const bytes = regularBytes(file, PLAN_LIMIT);
  if (bytes === null) return null;
  let fileAt: number;
  try {
    fileAt = Math.trunc(lstatSync(file).mtimeMs);
  } catch {
    return null;
  }
  const text = bytes.toString("utf8");
  let session: string | null = null;
  try {
    const j = JSON.parse(text) as { session_id?: unknown };
    session = typeof j.session_id === "string" ? j.session_id : null;
  } catch {
    session = null;
  }
  const last = session !== null && isSessionId(session) ? lastAssistantAt(join(claudeHome, "projects"), session) : null;
  return { text, file_at: fileAt, last_assistant_at: last };
}

/** The last 512 KiB of a regular file (never through a link), or null. */
function tailOf(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const start = Math.max(0, st.size - TAIL_BYTES);
    const buf = Buffer.alloc(st.size - start);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, start + off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** As `claude_plan.rs`'s `last_assistant_time`: `<session>.jsonl` in any folder under `projects`, its last assistant line with a time. */
export function lastAssistantAt(projects: string, session: string): number | null {
  if (!isSessionId(session)) return null;
  let entries;
  try {
    entries = readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const tail = tailOf(join(projects, entry.name, `${session}.jsonl`));
    if (tail === null) continue;
    for (const line of tail.split("\n").reverse()) {
      try {
        const j = JSON.parse(line) as { type?: unknown; timestamp?: unknown };
        if (j.type !== "assistant" || typeof j.timestamp !== "string" || !RFC3339.test(j.timestamp)) continue;
        const at = Date.parse(j.timestamp);
        if (Number.isFinite(at)) return at;
      } catch {
        // A cut first line, or a line that isn't JSON.
      }
    }
    return null;
  }
  return null;
}

/** `/proc/stat`'s first line: busy is everything but idle and iowait, over the first eight counters. */
export function cpuSample(proc: string): CpuSample | null {
  let first: string;
  try {
    first = readFileSync(join(proc, "stat"), "utf8").split("\n")[0] ?? "";
  } catch {
    return null;
  }
  const fields = first.trim().split(/\s+/);
  if (fields[0] !== "cpu") return null;
  const n = fields.slice(1, 9).map(Number);
  if (n.length < 8 || n.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const total = n.reduce((a, b) => a + b, 0);
  return { busy: total - n[3]! - n[4]!, total };
}

function meminfo(proc: string): { total: number; available: number } | null {
  let text: string;
  try {
    text = readFileSync(join(proc, "meminfo"), "utf8");
  } catch {
    return null;
  }
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB$`, "m").exec(text);
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  return total === null || available === null ? null : { total, available };
}

/** The host now, and the CPU sample the next reading compares with. */
export function hostNow(proc: string, disk: string, prev: CpuSample | null): { out: HostOut | null; cpu: CpuSample | null } {
  const cpu = cpuSample(proc);
  const mem = meminfo(proc);
  if (cpu === null || mem === null) return { out: null, cpu: null };
  let fs;
  try {
    fs = statfsSync(disk);
  } catch {
    return { out: null, cpu };
  }
  const total = fs.blocks * fs.bsize;
  const free = fs.bfree * fs.bsize;
  const moved = prev !== null && cpu.total > prev.total && cpu.busy >= prev.busy;
  return {
    out: {
      cpu_pct: moved ? Math.round(((cpu.busy - prev!.busy) / (cpu.total - prev!.total)) * 1000) / 10 : null,
      mem_used_gb: Math.max(0, mem.total - mem.available) / GIB,
      mem_total_gb: mem.total / GIB,
      disk_used_gb: Math.max(0, total - free) / GIB,
      disk_total_gb: total / GIB,
      disk_available_gb: (fs.bavail * fs.bsize) / GIB,
    },
    cpu,
  };
}

/** Token counts by day and model from this machine's transcripts, recounted at most once a gap. */
export function usageNow(claudeHome: string, prev: UsageOut | null, at: number, days = USAGE_DAYS): UsageOut {
  if (prev && at - prev.counted_at >= 0 && at - prev.counted_at < RECOUNT_GAP_MS) return prev;
  const from = lisbonDate(new Date(at - days * DAY_MS).toISOString()) ?? "";
  const rows = recount(join(claudeHome, "projects"), join(dirname(claudeHome), ".pi", "agent", "sessions"));
  return { counted_at: at, rows: rows.filter((r) => r.date >= from) };
}
