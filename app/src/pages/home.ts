// What Home says about usage (DESIGN.md §5 Home), kept pure so it is tested without a DOM: the three gauges that
// decide the day, and "Needs attention" — every reading past 80 % used, stale or dead, and every reader in error.

import type { ProviderMetricView, QuotaView, QuotaWindow, ReaderId, Subscription, UsageSnapshot } from "../api.ts";
import type { Tone } from "../ui/Bar.tsx";
import { metricLabel as convexLabel } from "../usage/convex.ts";
import { PROVIDER_LABEL, tone, usedPct, WINDOW_LABEL } from "../usage/format.ts";
import { metricLabel as hostingerLabel } from "../usage/hostinger.ts";

export interface HeroSlot {
  subscription: Subscription;
  window: QuotaWindow;
  quota: QuotaView | null;
}

/** Claude's week and session, then Ollama's first window (session, else week, else credits); a missing one is null. */
export function heroSlots(s: Pick<UsageSnapshot, "quotas">): HeroSlot[] {
  const find = (subscription: Subscription, window: QuotaWindow) => s.quotas.find((q) => q.subscription === subscription && q.window === window) ?? null;
  const ollama = (["session", "week", "month_credits"] as const).map((w) => find("ollama-cloud", w)).find((q) => q !== null) ?? null;
  return [
    { subscription: "claude-plan", window: "week", quota: find("claude-plan", "week") },
    { subscription: "claude-plan", window: "session", quota: find("claude-plan", "session") },
    { subscription: "ollama-cloud", window: ollama?.window ?? "session", quota: ollama },
  ];
}

export interface AttentionRow {
  key: string;
  label: string;
  /** The bar's percentage; null draws none (a dead reading, a reader in error). */
  used: number | null;
  value: string;
  unit: string;
  tone: Tone;
}

/** Danger first, then what is dead or failing, then warn, then stale. */
const RANK: Record<string, number> = { danger: 0, dead: 1, warn: 2, stale: 3 };

export function attention(s: UsageSnapshot): AttentionRow[] {
  const rows: (AttentionRow & { rank: number })[] = [];
  const reader = (id: ReaderId) => s.readers.find((r) => r.reader === id);
  const dead = (key: string, label: string, why: string) => rows.push({ key, label, used: null, value: "—", unit: why, tone: "meter", rank: RANK.dead! });
  const reading = (key: string, label: string, used: number, state: QuotaView["state"], upperBound = false) => {
    const t = tone(used, state);
    if (t === "meter") return;
    const unit = `used${upperBound && used > 100 ? " · upper bound" : ""}${t === "stale" ? " · stale" : ""}`;
    rows.push({ key, label, used, value: `${usedPct(used)}%`, unit, tone: t, rank: RANK[t]! });
  };

  // Claude and Ollama are the hero row: no reading from one of them is always worth saying.
  for (const subscription of ["claude-plan", "ollama-cloud"] as const) {
    const quotas = s.quotas.filter((q) => q.subscription === subscription);
    if (quotas.length === 0) {
      dead(subscription, PROVIDER_LABEL[subscription], reader(subscription)?.last_error ?? "no reading");
      continue;
    }
    for (const q of quotas) {
      const label = `${PROVIDER_LABEL[subscription]} · ${WINDOW_LABEL[q.window]}`;
      if (q.state === "dead") dead(`${subscription}/${q.window}`, label, reader(subscription)?.last_error ?? "no recent reading");
      else if (q.state !== "reset") reading(`${subscription}/${q.window}`, label, q.used_pct, q.state);
    }
  }

  // Convex and the VPS only once set up: a reader in error is said once, with its reason, instead of its rows.
  const providers = [
    { id: "convex" as const, name: "Convex", label: convexLabel },
    { id: "hostinger" as const, name: "Hostinger VPS", label: hostingerLabel },
  ];
  for (const p of providers) {
    const r = reader(p.id);
    if (!r || r.state === "not_configured") continue;
    const metrics = s.provider_metrics.filter((m: ProviderMetricView) => m.provider === p.id);
    if (r.state === "error" || metrics.some((m) => m.state === "dead")) {
      dead(p.id, p.name, r.last_error ?? "no recent reading");
    }
    for (const m of metrics) {
      if (m.used_pct === null || m.state === "dead") continue;
      reading(`${p.id}/${m.metric}/${m.window}`, `${p.name} · ${p.label(m.metric)}`, m.used_pct, m.state, p.id === "convex");
    }
  }

  // This Mac: a dead sample, or memory or disk filling up. CPU moves every sample and is never a warning.
  const host = s.host;
  if (host?.state === "dead") dead("host", "This Mac", reader("host")?.last_error ?? "no recent reading");
  else if (host) {
    if (host.mem_total_gb > 0) reading("host/memory", "This Mac · memory", (host.mem_used_gb / host.mem_total_gb) * 100, host.state);
    if (host.disk_total_gb > 0) reading("host/disk", "This Mac · disk", (host.disk_used_gb / host.disk_total_gb) * 100, host.state);
  }

  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.rank - b.row.rank || a.i - b.i)
    .map(({ row: { rank: _rank, ...row } }) => row);
}
