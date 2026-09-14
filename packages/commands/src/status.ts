// `status`: the Usage page as text or JSON (PRD R37), from the same rows through the StorageAdapter.

import { formatQuotaLine, leftPct, lisbonClock, quotaLabel, type Subscription } from "@kinas/store/quota-line";
import { readingState, type ReadingState } from "@kinas/store/staleness";
import type { HostRow, QuotaRow, ReaderRow, StorageAdapter, UsageRow } from "@kinas/store/types";

export type StatusState = ReadingState | "not_configured";

export interface StatusQuota extends QuotaRow {
  left_pct: number;
  state: ReadingState;
  reason: string | null;
}

export interface StatusProvider {
  subscription: Subscription;
  state: "not_configured" | "dead";
  reason: string;
}

export interface StatusResult {
  now: number;
  quotas: StatusQuota[];
  /** Providers with no readings at all. */
  missing: StatusProvider[];
  usageToday: UsageRow[];
  host: (HostRow & { state: ReadingState }) | null;
}

const DEFAULT_LIMITS: Record<string, [number, number]> = {
  "claude-plan": [1_800_000, 43_200_000],
  "ollama-cloud": [600_000, 43_200_000],
  host: [120_000, 43_200_000],
};

const lisbonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });

export function statusFromStore(store: StorageAdapter, now: number): StatusResult {
  const readers = store.getReaderStatus();
  const readerFor = (id: string): ReaderRow | undefined => readers.find((r) => r.reader === id);
  const limits = (id: string): [number, number] => {
    const r = readerFor(id);
    return r ? [r.stale_after_ms, r.dead_after_ms] : (DEFAULT_LIMITS[id] ?? [120_000, 43_200_000]);
  };

  const quotas = store.getQuotas().map((q) => {
    const [stale, dead] = limits(q.subscription);
    return {
      ...q,
      left_pct: 100 - q.used_pct,
      state: readingState({ updatedAt: q.updated_at, staleAfterMs: stale, deadAfterMs: dead, resetsAt: q.resets_at, now }),
      reason: readerFor(q.subscription)?.last_error ?? null,
    };
  });

  const missing: StatusProvider[] = [];
  for (const subscription of ["claude-plan", "ollama-cloud"] as const) {
    if (quotas.some((q) => q.subscription === subscription)) continue;
    const reader = readerFor(subscription);
    if (reader && reader.state === "error") {
      missing.push({ subscription, state: "dead", reason: reader.last_error ?? "no reading" });
    } else {
      missing.push({
        subscription,
        state: "not_configured",
        reason: subscription === "claude-plan" ? "not connected — add the Claude Code hook in Settings" : "not connected — add an API key in Settings",
      });
    }
  }

  const hostRow = store.getHost();
  const [hostStale, hostDead] = limits("host");
  return {
    now,
    quotas,
    missing,
    usageToday: store.getUsageDaily(lisbonDay.format(new Date(now))),
    host: hostRow ? { ...hostRow, state: readingState({ updatedAt: hostRow.updated_at, staleAfterMs: hostStale, deadAfterMs: hostDead, now }) } : null,
  };
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** R37 JSON: left_pct and used_pct, ISO times, a state per line. Never a secret — the store holds none. */
export function statusJson(result: StatusResult) {
  return {
    now: iso(result.now),
    quotas: [
      ...result.quotas.map((q) => ({
        subscription: q.subscription,
        window: q.window,
        label: quotaLabel(q.subscription, q.window),
        used_pct: q.used_pct,
        left_pct: q.left_pct,
        resets_at: iso(q.resets_at),
        updated_at: iso(q.updated_at),
        source: q.source,
        state: q.state as StatusState,
        reason: q.state === "dead" ? q.reason : null,
      })),
      ...result.missing.map((m) => ({
        subscription: m.subscription,
        window: null,
        label: quotaLabel(m.subscription, "session").split(" · ")[0],
        used_pct: null,
        left_pct: null,
        resets_at: null,
        updated_at: null,
        source: null,
        state: m.state as StatusState,
        reason: m.reason,
      })),
    ],
    usage_today: result.usageToday.map((u) => ({
      harness: u.harness,
      provider: u.provider,
      model: u.model,
      tokens_in: u.tokens_in,
      tokens_cache_read: u.tokens_cache_read,
      tokens_out: u.tokens_out,
      messages: u.messages,
    })),
    host: result.host && {
      machine: result.host.machine,
      cpu_pct: result.host.cpu_pct,
      mem_used_gb: result.host.mem_used_gb,
      mem_total_gb: result.host.mem_total_gb,
      disk_free_gb: result.host.disk_total_gb - result.host.disk_used_gb,
      disk_total_gb: result.host.disk_total_gb,
      updated_at: iso(result.host.updated_at),
      state: result.host.state,
    },
  };
}

const GOLD = "\x1b[38;2;223;174;60m";
const RESET = "\x1b[0m";
const LABEL_WIDTH = 19;

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** The text lines of `kinas status`. `color` adds gold to stale lines (TTY only). */
export function statusLines(result: StatusResult, color: boolean): string[] {
  const lines: string[] = [];
  const paint = (line: string, stale: boolean) => (color && stale ? `${GOLD}${line}${RESET}` : line);

  for (const q of result.quotas) {
    lines.push(paint(formatQuotaLine({ ...q, provider: q.subscription, reason: q.reason }, result.now), q.state === "stale"));
  }
  for (const m of result.missing) {
    const label = quotaLabel(m.subscription, "session").split(" · ")[0]!;
    lines.push(`${label.padEnd(LABEL_WIDTH)}${m.state === "dead" ? `— · ${m.reason}` : m.reason}`);
  }

  lines.push("");
  if (result.usageToday.length === 0) {
    lines.push("Today              no model usage yet");
  } else {
    lines.push("Today");
    for (const u of result.usageToday) {
      const label = `  ${u.harness} · ${u.model}`;
      lines.push(`${label.padEnd(Math.max(34, label.length + 1))}in ${compact(u.tokens_in)} · cache ${compact(u.tokens_cache_read)} · out ${compact(u.tokens_out)} · ${u.messages} msg${u.messages === 1 ? "" : "s"}`);
    }
  }

  lines.push("");
  if (!result.host) {
    lines.push("This Mac           no reading yet");
  } else {
    const h = result.host;
    const stale = h.state === "stale";
    const cpu = h.cpu_pct === null ? "—" : `${Math.round(h.cpu_pct)}%`;
    const line = `${"This Mac".padEnd(LABEL_WIDTH)}CPU ${cpu} · memory ${h.mem_used_gb.toFixed(1)}/${h.mem_total_gb.toFixed(1)} GiB · disk free ${(h.disk_total_gb - h.disk_used_gb).toFixed(0)} GiB · as of ${lisbonClock(h.updated_at, result.now)}${stale ? " (stale)" : ""}`;
    lines.push(paint(line, stale));
  }
  return lines;
}

export { leftPct };
