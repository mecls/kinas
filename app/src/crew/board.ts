import type { CrewPage, CrewPr, CrewReview, CrewSurface, CrewTask, CrewWord } from "../api.ts";
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
  "in review": "review",
  ready: "ready",
  done: "done",
  failed: "failed",
  paused: "paused",
  unknown: "unknown",
  gone: "gone",
};

/**
 * The Work page chrome's badge (first-mate PRD rule 24): a worker's pane wears its task's word, as its card does — every
 * word, `failed` and `paused` included; the first mate's pane, a shell, or a view of Herdr gone stale wears none.
 */
export function paneBadge(pane: { word: CrewWord | null; stale: boolean } | null): BadgeState | undefined {
  return pane?.word && !pane.stale ? BADGE_OF[pane.word] : undefined;
}

/** The caption's clock: the snapshot's own time, as a 24-hour local time. */
const secondsClock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

/**
 * "as of 09:31:12", or "stale · as of 09:31:12" once the snapshot is more than 60 s old (§4) — on Crew and Usage. A
 * snapshot made in what is now the future is from before a backwards clock step: its age is unknown, so it is stale,
 * as every reading is (`packages/store/src/staleness.ts`).
 */
export function fleetAsOf(generated: string | null, now: number): string | null {
  const at = generated ? Date.parse(generated) : NaN;
  if (Number.isNaN(at)) return null;
  const stale = at > now || now - at > 60_000;
  return `${stale ? "stale · " : ""}as of ${secondsClock(at)}`;
}

/** In flight: started and not finished, whatever the badge says (§7). */
export const inFlight = (t: CrewTask) => t.word !== "queued" && t.word !== "done" && t.word !== "gone";

const seenAt = (t: CrewTask, surface: CrewSurface) => (surface === "board" ? t.board_seen_at : t.overnight_seen_at);

/**
 * What a page shows in the load it opened at `openedAt` (done work clears, rules 3–5): every task but the finished
 * ones it stamped before that load — except those `keep` says this load has already drawn, so a card never leaves
 * under the captain's eyes. `stampedHere` holds the stamps this page asked for, for a reading taken before they were
 * written. Whether a task is finished is Rust's word (`finished`), never decided here.
 *
 * A stamp this page asked for and this load has not drawn was asked at an earlier load (this load asks only for what it
 * draws), so it is from before this load whatever the clock read: after the wall clock steps back, it reads later
 * than `openedAt`.
 */
export function onScreen(
  tasks: readonly CrewTask[],
  surface: CrewSurface,
  openedAt: number,
  keep: ReadonlySet<string>,
  stampedHere: ReadonlyMap<string, number> = new Map(),
): CrewTask[] {
  return tasks.filter((t) => {
    const at = seenAt(t, surface) ?? stampedHere.get(t.id) ?? null;
    const earlier = at !== null && (at < openedAt || stampedHere.has(t.id));
    return !(t.finished && earlier && !keep.has(t.id));
  });
}

/**
 * Whether the Crew page draws its Fleet section — the board, or the empty line and the reader's error — for this page
 * state: while the first mate runs, or while there is a card or an error to draw. Before setup the page is the setup
 * line and the tools, and no card is drawn, so nothing is "seen" there (done work clears, rule 4): a finished task the
 * mirror still holds (rule 11) must not be stamped by a board that is not showing it.
 */
export function fleetShown(page: CrewPage | undefined, taskCount: number, readerError: boolean): boolean {
  if (page === undefined || page === "uninstalled") return false;
  return page === "running" || taskCount > 0 || readerError;
}

/** A finished task's finish: when it was done, else when it went. A new one means it came back and finished again. */
export const finishOf = (t: CrewTask): number | null => t.done_at ?? t.gone_at;

/**
 * Forgets the stamps this page asked for whose task has come back since (done work clears, rule 7): read unfinished, or
 * finished at another moment than the one it stamped, or — given the page's `surface` and its `confirmed` set — its
 * stamp for that surface read by an earlier reading and missing from this one. Rust removes a stamp only when the task
 * comes back (`forget_seen`), and a done task that was torn down and returns keeps its `done_at`, so only the stamp's
 * going says it is new again. Runs on every reading, the page on screen or not — a hidden page draws nothing, so its
 * memory of a finish must not outlive that finish, or the next one is cleared unseen. A task this reading does not
 * list keeps its entry.
 */
export function forgetComeBack(
  tasks: readonly CrewTask[],
  stamped: Map<string, number>,
  finishes: Map<string, number | null>,
  surface?: CrewSurface,
  confirmed: Set<string> = new Set(),
): void {
  for (const t of tasks) {
    if (!stamped.has(t.id)) continue;
    const rust = surface ? seenAt(t, surface) : null;
    if (!t.finished || finishOf(t) !== finishes.get(t.id) || (rust === null && confirmed.has(t.id))) {
      stamped.delete(t.id);
      finishes.delete(t.id);
      confirmed.delete(t.id);
    } else if (rust !== null) confirmed.add(t.id);
  }
}

/** The finished tasks among those drawn with no stamp for this surface yet: what the page sends to be stamped. */
export function toStamp(shown: readonly CrewTask[], surface: CrewSurface): string[] {
  return shown.filter((t) => t.finished && seenAt(t, surface) === null).map((t) => t.id);
}

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

/** A time span in its largest whole unit (build-spec §11.2): "41 min", "1 h", "2 d". Recent's ages, and slice 7's task
 * lines. Under a minute is "0 min". */
export function largestUnit(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/**
 * "working 12 min", "done in 41 min", or "" when there is no start. It counts from the fleet ledger's dispatch when Kinas
 * kept one (DESIGN.md 1.12), else from when Kinas first saw the task working; "done in" runs to the ledger's merge, else
 * to when Kinas first saw it done.
 */
export function elapsedText(t: Pick<CrewTask, "word" | "first_working_at" | "dispatched_at" | "done_at" | "merged_at">, now: number): string {
  const start = t.dispatched_at ?? t.first_working_at;
  if (start === null) return "";
  const end = t.merged_at ?? t.done_at;
  if (end !== null && (t.word === "done" || t.word === "gone" || t.done_at !== null)) return `done in ${duration(Math.max(0, end - start))}`;
  if (!inFlight(t as CrewTask)) return "";
  return `working ${duration(Math.max(0, now - start))}`;
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

/**
 * The review flag's line (the captain's (b); DESIGN.md 1.14): what the PR or branch changes that a merged hook or MCP
 * server would run from, in the captain's own sessions. Null when there is nothing to review.
 */
export function reviewLine(review: CrewReview | null): string | null {
  if (!review || (review.paths.length === 0 && !review.unknown)) return null;
  const claude = review.paths.some((p) => p.split("/").includes(".claude"));
  const mcp = review.paths.some((p) => p.split("/").pop() === ".mcp.json");
  const what = claude && mcp ? ".claude/ and .mcp.json" : claude ? ".claude/" : mcp ? ".mcp.json" : null;
  return what ? `touches ${what} — review before merging` : "too many files to check — review before merging";
}

/** The card's quiet line: "ship · claude · working 12 min", without the parts it does not know. */
export function metaLine(t: CrewTask, now: number): string {
  return [t.kind, t.harness, elapsedText(t, now)].filter((p): p is string => !!p).join(" · ");
}
