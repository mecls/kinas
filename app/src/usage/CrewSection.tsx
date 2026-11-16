import type { CrewSnapshot } from "../api.ts";
import { fleetAsOf, inFlight } from "../crew/board.ts";
import { failedRead } from "../pages/readFailure.ts";
import { MetricRow, Rows, Section, SectionHeader } from "../ui/index.ts";

// Usage's Crew section (build spec §4 Usage; mockup usage-and-menu-bar.html): what the crew has running, counted by
// harness, then what waits — rows without bars, because Firstmate publishes no allowance to fill one against. Gone
// when nothing is in flight or queued. Last on the page, after This Mac.

/** One row per harness with a task in flight, busiest first then by name; a task Firstmate names no harness for counts
 *  under "harness unknown". */
export function crewRows(crew: CrewSnapshot): { harness: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const t of crew.tasks.filter(inFlight)) counts.set(t.harness ?? "harness unknown", (counts.get(t.harness ?? "harness unknown") ?? 0) + 1);
  return [...counts].map(([harness, n]) => ({ harness, n })).sort((a, b) => b.n - a.n || a.harness.localeCompare(b.harness));
}

/**
 * Lanes (DESIGN.md 1.12): while the captain has set a fixed lane cap and Firstmate gave a number, the lanes in use of
 * the cap, its bar filled to them — in --stale once the reading is older than 120 s, as the Crew page's caption says it.
 */
export function lanesRow(crew: CrewSnapshot): { inUse: number; cap: number; pct: number; stale: boolean } | null {
  const l = crew.lanes;
  if (!l || l.cap === null || l.free === null || l.cap === 0) return null;
  const inUse = Math.max(0, l.cap - l.free);
  return { inUse, cap: l.cap, pct: Math.min(100, (inUse / l.cap) * 100), stale: l.at > crew.now || crew.now - l.at > 120_000 };
}

/** `error`: the crew's reading itself failed after this one (crew/useCrew.ts) — said beside it, as Crew, Inbox and Home
 *  say it, since its caption has stopped ageing (ADR 0004). */
export function CrewSection({ crew, error = null }: { crew: CrewSnapshot | null; error?: string | null }) {
  if (!crew) return null;
  const rows = crewRows(crew);
  const queued = crew.tasks.filter((t) => t.word === "queued").length;
  const lanes = lanesRow(crew);
  if (rows.length === 0 && queued === 0 && !lanes) return null;
  const unread = failedRead("crew", error, true);
  return (
    <Section className="usage-provider" data-section="crew">
      <SectionHeader title="Crew" caption={fleetAsOf(crew.generated, crew.now) ?? undefined} source="Firstmate's fleet snapshot" />
      {unread && (
        <p className="usage-note" data-testid="usage-crew-error">
          {unread}
        </p>
      )}
      <Rows>
        {rows.map((r) => (
          <MetricRow key={r.harness} label={r.harness} used={null} value={r.n} unit="in flight" data-metric={`crew-${r.harness}`} />
        ))}
        {queued > 0 && <MetricRow label="Queued" used={null} value={queued} unit={queued === 1 ? "task" : "tasks"} data-metric="crew-queued" />}
        {lanes && <MetricRow label="Lanes" used={lanes.pct} tone={lanes.stale ? "stale" : "meter"} value={lanes.inUse} unit={`of ${lanes.cap} in use`} data-metric="crew-lanes" />}
      </Rows>
    </Section>
  );
}
