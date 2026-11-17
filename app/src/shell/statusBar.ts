import type { CrewSnapshot, ProviderMetricView, QuotaView, UsageSnapshot } from "../api.ts";
import { heroSlots } from "../pages/home.ts";
import { categoriesFor } from "../ui/category.ts";
import type { Category } from "../ui/Dot.tsx";
import type { Tone } from "../ui/Bar.tsx";
import * as convex from "../usage/convex.ts";
import { asOf, PROVIDER_LABEL, resetsCaption, tone, usedPct, WINDOW_LABEL } from "../usage/format.ts";
import { connectionOf, type Connection } from "./connection.ts";

// The status bar's words (tasks/interface-polish, PRD rules 23–25; DESIGN.md §4 Status bar and Usage popover, 1.13):
// pure, from App's one usage snapshot and its one crew reading, so the bar never disagrees with Home, Usage or the
// Crew page. The bar draws them (ui/StatusBar.tsx); the popover draws `popoverBlocks` (ui/UsagePopover.tsx).

/** One reading on the bar's left: "Claude session" and "97%", with its tone only when it matters. */
export interface BarReading {
  key: string;
  label: string;
  pct: string;
  /** Warn, danger or stale: drawn as the tone's dot. Null for a fine reading, which shows no dot (rule 24). */
  tone: Exclude<Tone, "meter"> | null;
}

/** The crew's counts on the bar's right; each part only when it is not zero. */
export interface CrewTotals {
  needsYou: number;
  failed: number;
  working: number;
}

export interface BarModel {
  readings: BarReading[];
  /** No quota at all: the left is one button, "No usage readings — Settings → Providers". */
  empty: boolean;
  /** Null before the crew is set up, or before it has been read. */
  crew: CrewTotals | null;
  /** Null when no VPS is watched. */
  vps: Connection | null;
}

/** A tone the bar draws: warn, danger and stale. A dead or reset reading has no number to warn about. */
function barTone(q: QuotaView): BarReading["tone"] {
  const t = tone(q.used_pct, q.state);
  return t === "meter" ? null : t;
}

/** The crew as the bar counts it: what waits on the captain (the Inbox's count), what failed, what is working. */
export function crewTotals(crew: CrewSnapshot | null): CrewTotals | null {
  if (!crew || crew.page === "uninstalled") return null;
  const live = crew.tasks.filter((t) => !t.finished);
  return {
    needsYou: crew.waiting,
    failed: live.filter((t) => t.word === "failed" || t.word === "CI red").length,
    working: live.filter((t) => t.word === "working").length,
  };
}

/** "1 needs you · 1 failed · 2 working", nothing for a zero; "" when every count is zero. */
export function crewWords(totals: CrewTotals): { key: keyof CrewTotals; text: string }[] {
  return [
    { key: "needsYou" as const, text: `${totals.needsYou} needs you` },
    { key: "failed" as const, text: `${totals.failed} failed` },
    { key: "working" as const, text: `${totals.working} working` },
  ].filter((p) => totals[p.key] > 0);
}

/** The bar's model: Home's three gauges as readings, the crew's counts, the VPS (rules 23–24). */
export function statusModel(snapshot: UsageSnapshot | null, crew: CrewSnapshot | null, readError: string | null = null): BarModel {
  const slots = snapshot ? heroSlots(snapshot) : [];
  const readings = slots.flatMap((s): BarReading[] => {
    const q = s.quota;
    if (!q) return [];
    const shown = q.state === "dead" || q.state === "reset" ? "—" : `${usedPct(q.used_pct)}%`;
    return [{ key: `${s.subscription}/${s.window}`, label: `${PROVIDER_LABEL[s.subscription]} ${WINDOW_LABEL[s.window]}`, pct: shown, tone: barTone(q) }];
  });
  return {
    readings,
    empty: snapshot !== null && readings.length === 0,
    crew: crewTotals(crew),
    vps: snapshot ? connectionOf(snapshot, readError) : null,
  };
}

/** One window of one provider in the popover: its label, its bar, "24% used" and its reset. */
export interface PopoverWindow {
  key: string;
  label: string;
  used: number | null;
  tone: Tone;
  usedText: string;
  reset: string;
  resetTitle: string;
}

export interface PopoverBlock {
  provider: string;
  cat: Category;
  /** "as of 13:50", the block's oldest reading. */
  asOf: string;
  windows: PopoverWindow[];
}

const quotaWindow = (q: QuotaView, now: number): PopoverWindow => {
  const hidden = q.state === "dead" || q.state === "reset";
  const caption = resetsCaption(q.resets_at, now);
  return {
    key: `${q.subscription}/${q.window}`,
    label: WINDOW_LABEL[q.window],
    used: hidden ? null : q.used_pct,
    tone: tone(q.used_pct, q.state),
    usedText: hidden ? (q.state === "dead" ? "No reading" : "Reset, waiting for a new reading") : `${usedPct(q.used_pct)}% used${q.state === "stale" ? " · stale" : ""}`,
    reset: hidden ? "" : caption.text,
    resetTitle: caption.title,
  };
};

const metricWindow = (m: ProviderMetricView): PopoverWindow => ({
  key: `convex/${m.metric}`,
  label: convex.metricLabel(m.metric),
  used: m.state === "dead" ? null : m.used_pct,
  tone: tone(m.used_pct, m.state),
  usedText: m.state === "dead" || m.used_pct === null ? "No reading" : `${usedPct(m.used_pct)}% used${m.state === "stale" ? " · stale" : ""}`,
  reset: "this calendar month (UTC)",
  resetTitle: convex.BILLING_WINDOW,
});

const oldest = (times: number[], now: number) => asOf(Math.min(...times), now);

/**
 * One block per configured provider (rule 25, clarified at Gate 2): Claude's and Ollama's windows, and those of Convex's
 * month metrics that have an allowance. The VPS is not here: it is a line on the bar. A provider with nothing read is
 * left out; with nothing at all, the popover is empty and says so.
 */
export function popoverBlocks(snapshot: UsageSnapshot): PopoverBlock[] {
  const providers = ["Claude", "Ollama", "Convex"];
  const cats = categoriesFor(providers, {});
  const blocks: PopoverBlock[] = [];
  for (const subscription of ["claude-plan", "ollama-cloud"] as const) {
    const quotas = snapshot.quotas.filter((q) => q.subscription === subscription);
    if (quotas.length === 0) continue;
    const name = PROVIDER_LABEL[subscription];
    blocks.push({ provider: name, cat: cats[name]!, asOf: oldest(quotas.map((q) => q.updated_at), snapshot.now), windows: quotas.map((q) => quotaWindow(q, snapshot.now)) });
  }
  const gauged = convex.forWindow(snapshot.provider_metrics, "month", convex.GAUGED).filter((m) => m.limit_value !== null && m.used_pct !== null);
  if (gauged.length > 0) {
    blocks.push({ provider: "Convex", cat: cats.Convex!, asOf: oldest(gauged.map((m) => m.updated_at), snapshot.now), windows: gauged.map(metricWindow) });
  }
  return blocks;
}
