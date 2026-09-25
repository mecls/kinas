import type { CrewPr, CrewTask, CrewWord } from "../api.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import type { BadgeState } from "../ui/StatusBadge.tsx";
import type { Category } from "../ui/Dot.tsx";

// The Crew board's rules (build spec §4 Crew page; PRD rules 18–19; DESIGN.md 1.4 Lane): lanes by GitHub repository,
// their counts in Firstmate's words, the cards' order, the elapsed time and the PR line. Pure, so board.test.ts holds
// them; crew/Board.tsx only draws.

export interface LaneModel {
  /** The folder's path, `repo:<owner/name>` or `project:<name>`. */
  key: string;
  name: string;
  /** The folder's chip; null for a lane no client folder matches. */
  cat: Category | null;
  internal: boolean;
  /** `owner/name` when the lane is a repository's, for `data-repo`. */
  repo: string | null;
  counts: string;
  tasks: CrewTask[];
}

/** Every word Rust derives, drawn by its badge (DESIGN.md §4's table, 1.4). */
export const BADGE_OF: Record<CrewWord, BadgeState> = {
  queued: "queued",
  working: "working",
  "needs decision": "decision",
  blocked: "blocked",
  "CI red": "red",
  "PR open": "pr",
  ready: "ready",
  done: "done",
  failed: "failed",
  paused: "paused",
  unknown: "unknown",
  gone: "gone",
};

/** The caption's clock: the snapshot's own time, as a 24-hour local time. */
const secondsClock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

/** "as of 09:31:12", or "stale · as of 09:31:12" once the snapshot is more than 60 s old (§4) — on Crew and Usage. */
export function fleetAsOf(generated: string | null, now: number): string | null {
  const at = generated ? Date.parse(generated) : NaN;
  if (Number.isNaN(at)) return null;
  return `${now - at > 60_000 ? "stale · " : ""}as of ${secondsClock(at)}`;
}

/** In flight: started and not finished, whatever the badge says (§7). */
export const inFlight = (t: CrewTask) => t.word !== "queued" && t.word !== "done" && t.word !== "gone";

/**
 * One lane per client folder with a task, matched by GitHub repository and never by name (PRD rule 18), in the
 * sidebar's folder order; then a lane per repository no folder matches, under the repository's name, and one per
 * project whose clone has no GitHub `origin`, under the project's name — those two kinds together, by name, without
 * chips. A hidden folder keeps its lane; a removed one is forgotten. A lane exists only while it has a task (rule 19).
 */
export function lanesOf(tasks: readonly CrewTask[], folders: readonly SeatedFolder[]): LaneModel[] {
  const known = folders.filter((f) => !f.removed && f.repo);
  const byFolder = new Map<string, CrewTask[]>();
  const others = new Map<string, { name: string; repo: string | null; tasks: CrewTask[] }>();
  for (const t of tasks) {
    const folder = t.repo ? known.find((f) => f.repo === t.repo) : undefined;
    if (folder) {
      byFolder.set(folder.path, [...(byFolder.get(folder.path) ?? []), t]);
      continue;
    }
    const key = t.repo ? `repo:${t.repo}` : `project:${t.project_name ?? t.id}`;
    const name = t.repo ? t.repo.slice(t.repo.indexOf("/") + 1) : (t.project_name ?? t.id);
    const lane = others.get(key) ?? { name, repo: t.repo, tasks: [] };
    lane.tasks.push(t);
    others.set(key, lane);
  }
  const lane = (key: string, name: string, cat: Category | null, internal: boolean, repo: string | null, list: CrewTask[]): LaneModel => ({
    key,
    name,
    cat,
    internal,
    repo,
    counts: laneCounts(list),
    tasks: cardOrder(list),
  });
  const folderLanes = known.filter((f) => byFolder.has(f.path)).map((f) => lane(f.path, f.name, f.cat, f.internal, f.repo, byFolder.get(f.path)!));
  const otherLanes = [...others]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([key, o]) => lane(key, o.name, null, false, o.repo, o.tasks));
  return [...folderLanes, ...otherLanes];
}

/** "2 in flight · 1 queued", each part only when it is not zero; "" when nothing runs or waits. */
export function laneCounts(tasks: readonly CrewTask[]): string {
  const flying = tasks.filter(inFlight).length;
  const queued = tasks.filter((t) => t.word === "queued").length;
  return [flying > 0 ? `${flying} in flight` : null, queued > 0 ? `${queued} queued` : null].filter(Boolean).join(" · ");
}

/** In flight first (newest first), then queued, then done, then gone. */
export function cardOrder(tasks: readonly CrewTask[]): CrewTask[] {
  const rank = (t: CrewTask) => (inFlight(t) ? 0 : t.word === "queued" ? 1 : t.word === "done" ? 2 : 3);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.first_seen_at - a.first_seen_at || a.id.localeCompare(b.id));
}

/** "41 min", "1 h 12 min", "2 h 05 min". */
export function duration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** "working 12 min" from when Kinas first saw it working, "done in 41 min", or "" when it was never seen working. */
export function elapsedText(t: CrewTask, now: number): string {
  if (t.first_working_at === null) return "";
  if (t.done_at !== null) return `done in ${duration(t.done_at - t.first_working_at)}`;
  if (!inFlight(t)) return "";
  return `working ${duration(now - t.first_working_at)}`;
}

/**
 * "PR #123 · checks 3/4 · 1 failing", "PR #58 · checks 4/4 · mergeable", "PR #7 · draft" — the checks and the rest once
 * `gh` has answered (Rust's `gh::checks_text` says the checks the same way).
 */
export function prLine(pr: CrewPr | null): string | null {
  if (!pr) return null;
  const parts = [`PR #${pr.number}`];
  const total = pr.checks_total ?? 0;
  const failed = pr.checks_failed ?? 0;
  if (total > 0) parts.push(`checks ${total - failed}/${total}`);
  if (failed > 0) parts.push(`${failed} failing`);
  else if (pr.state === "MERGED") parts.push("merged");
  else if (pr.state === "CLOSED") parts.push("closed");
  else if (pr.draft) parts.push("draft");
  else if (pr.mergeable === "MERGEABLE") parts.push("mergeable");
  return parts.join(" · ");
}

/** The card's quiet line: "ship · claude · working 12 min", without the parts it does not know. */
export function metaLine(t: CrewTask, now: number): string {
  return [t.kind, t.harness, elapsedText(t, now)].filter((p): p is string => !!p).join(" · ");
}
