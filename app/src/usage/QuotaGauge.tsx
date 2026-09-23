import type { QuotaView, ReaderView } from "../api.ts";
import { Gauge } from "../ui/index.ts";
import { asOf, lisbonClock, PROVIDER_LABEL, resetsIn, tone, usedPct, WINDOW_LABEL } from "./format.ts";

// One quota as a gauge, the same on Home and on Usage (DESIGN.md §4 Gauge), and the caption a section of readings
// carries. The number never lies: a dead reading says why, a window past its reset shows "—" (its stored number belongs
// to a window that ended), and a stale one keeps its number with its age said beside it.

/** A section's one freshness caption: "as of" its oldest reading, the only place freshness appears but for stale. */
export function asOfOldest(readings: readonly { updated_at: number | null }[], now: number): string | undefined {
  const times = readings.map((r) => r.updated_at).filter((t): t is number => t !== null);
  return times.length === 0 ? undefined : asOf(Math.min(...times), now);
}

/** Where a section's readings come from, for the caption's hover. */
export const sourcesOf = (readings: readonly { source: string }[]) => [...new Set(readings.map((r) => `Source: ${r.source}`))].join("\n") || undefined;

/** "Claude · week", "Ollama · session" — and the plan when the provider names one. */
export const quotaTitle = (q: QuotaView) => `${PROVIDER_LABEL[q.subscription]} · ${WINDOW_LABEL[q.window]}${q.plan ? ` · ${q.plan}` : ""}`;

/** The line under a quota: when it resets, or why there is no number, or how old a stale one is. */
export function quotaDetail(q: QuotaView, reader: ReaderView | undefined, now: number): string {
  if (q.state === "reset") return `reset at ${q.resets_at === null ? "—" : lisbonClock(q.resets_at, now)} · waiting for a new reading`;
  if (q.state === "dead") return reader?.last_error ?? "no recent reading";
  const resets = resetsIn(q.resets_at, now);
  return q.state === "stale" ? `${resets} · ${asOf(q.updated_at, now)} · stale` : resets;
}

/** Hidden number: dead, or a window past its reset. Otherwise "% used", rounded up so usage is never understated. */
export const shownUsed = (q: { state: string; used_pct: number | null }) => (q.state === "dead" || q.state === "reset" || q.used_pct === null ? null : Number(usedPct(q.used_pct)));

export function QuotaGauge({ quota, reader, now }: { quota: QuotaView; reader: ReaderView | undefined; now: number }) {
  return (
    <Gauge
      title={quotaTitle(quota)}
      used={shownUsed(quota)}
      unit="% used"
      tone={tone(quota.used_pct, quota.state)}
      detail={quotaDetail(quota, reader, now)}
      dead={quota.state === "dead"}
      muted={quota.state === "stale"}
      placeholder="—"
      data-subscription={quota.subscription}
      data-window={quota.window}
      data-state={quota.state}
    />
  );
}
