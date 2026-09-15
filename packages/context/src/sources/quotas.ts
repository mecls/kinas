// Quotas: what is left of every plan, from local data only.
//
//   Claude, Ollama — the app's store (read-only), which the app fills from Claude Code's status-line hook and
//                    Ollama's usage endpoint. The CLI never calls a provider itself.
//   Codex          — the newest `rate_limits` event in Codex's own session logs ($CODEX_HOME/sessions).
//
// Each line carries when its number was true; a reading older than fifteen minutes is stale, whatever the reader's
// own cadence.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { statusFromStore } from "@kinas/commands";
import { openReadOnly, type SqliteReadOnlyStore } from "@kinas/store/sqlite-readonly";
import type { QuotaLine, QuotaState } from "../packet.ts";
import { STALE_AFTER_MS } from "../time.ts";

const PROVIDER = { "claude-plan": "Claude", "ollama-cloud": "Ollama" } as const;
const WINDOW = { session: "session", week: "week", month_credits: "credits" } as const;

export function freshness(state: QuotaState, updatedAt: number | null, now: number): QuotaState {
  if (state === "fresh" && updatedAt !== null && now - updatedAt > STALE_AFTER_MS) return "stale";
  return state;
}

export type StoreOpen = { ok: true; store: SqliteReadOnlyStore } | { ok: false; note: string };

export function openStore(dataDir: string): StoreOpen {
  const opened = openReadOnly(dataDir);
  if (opened.ok) return opened;
  if (opened.reason === "missing") return { ok: false, note: "the Kinas app has not run yet" };
  if (opened.reason === "newer") return { ok: false, note: "the app's store is newer than this CLI (stale ~/.local/bin link)" };
  return { ok: false, note: `the app's store could not be read (${opened.message})` };
}

export function storeQuotas(opened: StoreOpen, now: number): QuotaLine[] {
  if (!opened.ok) {
    return (["Claude", "Ollama"] as const).map((provider) => ({ provider, window: null, left_pct: null, resets_at: null, updated_at: null, state: "not_connected", note: opened.note }));
  }
  const status = statusFromStore(opened.store, now);
  return [
    ...status.quotas.map(
      (q): QuotaLine => ({
        provider: PROVIDER[q.subscription],
        window: WINDOW[q.window],
        left_pct: Math.floor(q.left_pct),
        resets_at: q.resets_at,
        updated_at: q.updated_at,
        state: freshness(q.state, q.updated_at, now),
        note: q.state === "dead" ? q.reason : null,
      }),
    ),
    ...status.missing.map(
      (m): QuotaLine => ({
        provider: PROVIDER[m.subscription],
        window: null,
        left_pct: null,
        resets_at: null,
        updated_at: null,
        state: m.state === "dead" ? "dead" : "not_connected",
        note: m.reason,
      }),
    ),
  ];
}

function windowLabel(minutes: number | null): string {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "week";
  if (minutes === null || !Number.isFinite(minutes)) return "window";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The rate-limit windows in one Codex log line, or null when the line has none. */
export function codexWindows(line: string, now: number): QuotaLine[] | null {
  if (!line.includes("rate_limits")) return null;
  let event: Json;
  try {
    event = JSON.parse(line) as Json;
  } catch {
    return null;
  }
  const payload = (event.payload ?? event) as Json;
  const limits = (payload.rate_limits ?? (payload.info as Json | undefined)?.rate_limits) as Json | undefined;
  if (!limits || typeof limits !== "object") return null;
  const at = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
  const updatedAt = Number.isFinite(at) ? at : null;

  const windows: QuotaLine[] = [];
  for (const key of ["primary", "secondary"]) {
    const w = limits[key] as Json | undefined | null;
    const used = num(w?.used_percent);
    if (!w || used === null) continue;
    const resetsAtSec = num(w.resets_at);
    const resetsIn = num(w.resets_in_seconds);
    const resetsAt = resetsAtSec !== null ? resetsAtSec * 1000 : resetsIn !== null && updatedAt !== null ? updatedAt + resetsIn * 1000 : null;
    const state: QuotaState = resetsAt !== null && now >= resetsAt ? "reset" : freshness("fresh", updatedAt, now);
    windows.push({
      provider: "Codex",
      window: windowLabel(num(w.window_minutes)),
      left_pct: Math.floor(100 - used),
      resets_at: resetsAt,
      updated_at: updatedAt,
      state,
      note: null,
    });
  }
  return windows.length > 0 ? windows : null;
}

async function newestRollouts(sessions: string, limit: number): Promise<string[]> {
  const names = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort().reverse();
  const out: string[] = [];
  for (const y of (await names(sessions)).filter((n) => /^\d{4}$/.test(n))) {
    for (const m of (await names(join(sessions, y))).filter((n) => /^\d{2}$/.test(n))) {
      for (const d of (await names(join(sessions, y, m))).filter((n) => /^\d{2}$/.test(n))) {
        for (const f of (await names(join(sessions, y, m, d))).filter((n) => n.startsWith("rollout-") && n.endsWith(".jsonl"))) {
          out.push(join(sessions, y, m, d, f));
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

export async function codexQuotas(codexHome: string, now: number): Promise<QuotaLine[]> {
  const none = (note: string): QuotaLine[] => [{ provider: "Codex", window: null, left_pct: null, resets_at: null, updated_at: null, state: "not_connected", note }];
  if (!existsSync(codexHome)) return none("no Codex folder on this Mac");
  for (const file of await newestRollouts(join(codexHome, "sessions"), 5)) {
    const blob = Bun.file(file);
    const tail = await blob.slice(Math.max(0, blob.size - 512 * 1024)).text();
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const windows = codexWindows(lines[i]!, now);
      if (windows) return windows;
    }
  }
  return none("no rate-limit reading in recent Codex sessions");
}
