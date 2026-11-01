// Crew from the app's mirror (the first mate's build spec §4 The CLI): when the app's collector succeeded less than five
// minutes ago, the packet's Crew section is read from its store — read-only, in milliseconds — instead of running
// Firstmate's fleet snapshot, which takes seconds. Older than that, or no mirror at all, and `refresh.ts` falls back to
// the snapshot as before. The same fields either way: what is in flight, what is queued, what waits on the captain,
// and the newest scout reports.

import type { CrewDecisionRow, CrewMirrorRow, ReaderRow } from "@kinas/store/types";
import type { Crew, CrewBrief, CrewHold, CrewReport, CrewTask } from "../packet.ts";
import { within } from "../time.ts";
import { FLEET_SCHEMA, readReport } from "./firstmate.ts";

/** The mirror stands for the fleet while the collector's last success is younger than this. */
export const MIRROR_FRESH_MS = 5 * 60_000;
const REPORTS_SHOWN = 5;

/** The store's reads this needs. */
export interface MirrorStore {
  getReaderStatus(): ReaderRow[];
  getCrewMirror(now: number): CrewMirrorRow[];
  getCrewDecisions(): CrewDecisionRow[];
}

/**
 * The crew from the mirror, or null when the mirror is not fresh enough to stand for the fleet. `now` may be a clock,
 * read once the collector's status is read: a mirror written since an earlier moment is not judged against it.
 */
export async function crewFromStore(store: MirrorStore, now: number | (() => number), home: string): Promise<Crew | null> {
  const status = store.getReaderStatus().find((r) => r.reader === "crew");
  const at = typeof now === "function" ? now() : now;
  if (!status?.last_success_at || !within(status.last_success_at, at, MIRROR_FRESH_MS)) return null;
  const rows = store.getCrewMirror(at).filter((r) => r.gone_at === null);

  const inFlight: CrewTask[] = rows
    .filter((r) => r.backlog_state === "in_flight" || (r.backlog_state === null && r.done_at === null))
    .map((r) => ({ id: r.id, title: r.title ?? r.id, project: r.project ?? r.project_name, kind: r.kind, state: r.state ?? "no task metadata", worktree: r.worktree_path }));
  const intake: CrewBrief[] = rows
    .filter((r) => r.backlog_state === "queued" && r.captain_actionable === 0)
    .map((r) => ({ id: r.id, title: r.title ?? r.id, repo: r.project_name, filed: null }));
  const blocked: CrewHold[] = [];
  for (const d of store.getCrewDecisions()) {
    if (!blocked.some((b) => b.id === d.task_id)) blocked.push({ id: d.task_id, title: d.task_title ?? d.task_id, reason: d.summary || null });
  }
  const reports: CrewReport[] = (
    await Promise.all(
      rows
        .filter((r) => r.kind === "scout" && r.report_present === 1 && r.report_path)
        // Only under the home, as the snapshot's reports (firstmate.ts `readReport`, ADR 0019).
        .map((r): Promise<CrewReport | null> => readReport(home, r.report_path!, r.id)),
    )
  )
    .filter((r): r is CrewReport => r !== null)
    .sort((a, b) => b.modified_at - a.modified_at)
    .slice(0, REPORTS_SHOWN);
  const generated = rows.map((r) => r.snapshot_generated).sort().pop() ?? new Date(status.last_success_at).toISOString();
  return { home, schema: FLEET_SCHEMA, generated, in_flight: inFlight, intake, blocked, reports };
}
