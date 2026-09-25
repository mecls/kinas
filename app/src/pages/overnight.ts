import type { CrewDecision, CrewTask, CrewWord } from "../api.ts";
import { BADGE_OF, lanesOf } from "../crew/board.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import type { Segments } from "../ui/Bar.tsx";
import type { BadgeState } from "../ui/StatusBadge.tsx";

// Home's Overnight (build spec §4 Home; PRD rule 21; DESIGN.md 1.4; mockup home.html): for each client folder, the
// crew's tasks with activity since the end of the captain's last session — counted in four buckets for the bar and by
// word for the badges, the latest event in one line, and the task a click opens. Pure, so overnight.test.ts holds it.

export interface OvernightRow {
  folder: SeatedFolder;
  /** "Needs decision: REST or GraphQL? 05:48"; null for a folder with no work overnight. */
  event: string | null;
  seg: Segments | null;
  badges: { state: BadgeState; count: number }[];
  /** The task a click opens in the panel: the one waiting on a person, then a failed one, then the latest. */
  target: string | null;
}

type Bucket = keyof Segments;

/** §7's buckets, over the word without the gone rule (a task done then gone counts as done). */
export function bucketOf(word: CrewWord): Bucket {
  switch (word) {
    case "done":
      return "done";
    case "needs decision":
    case "ready":
      return "wait";
    case "failed":
    case "blocked":
    case "CI red":
      return "fail";
    default:
      return "working";
  }
}

/** The badges' order: what needs the captain first. */
const BADGE_ORDER: CrewWord[] = ["needs decision", "ready", "failed", "blocked", "CI red", "PR open", "working", "paused", "unknown", "queued", "done"];

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** When a task last did something the captain would count: its newest event, its finish, or its filing. */
const activityAt = (t: CrewTask) => Math.max(t.last_event_at ?? 0, t.done_at ?? 0, t.first_seen_at);

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function overnightRows(folders: readonly SeatedFolder[], tasks: readonly CrewTask[], since: number, decisions: readonly CrewDecision[] = []): OvernightRow[] {
  const lanes = lanesOf(tasks, folders);
  return folders.map((folder) => {
    const lane = lanes.find((l) => l.key === folder.path);
    const night = (lane?.tasks ?? []).filter((t) => activityAt(t) >= since);
    if (night.length === 0) return { folder, event: null, seg: null, badges: [], target: null };
    const seg: Segments = { done: 0, working: 0, wait: 0, fail: 0 };
    const words = new Map<CrewWord, number>();
    for (const t of night) {
      seg[bucketOf(t.overnight_word)] += 1;
      words.set(t.overnight_word, (words.get(t.overnight_word) ?? 0) + 1);
    }
    const badges = BADGE_ORDER.filter((w) => words.has(w)).map((w) => ({ state: BADGE_OF[w], count: words.get(w)! }));
    const newest = (list: CrewTask[]) => [...list].sort((a, b) => activityAt(b) - activityAt(a))[0];
    const target =
      newest(night.filter((t) => bucketOf(t.overnight_word) === "wait")) ?? newest(night.filter((t) => bucketOf(t.overnight_word) === "fail")) ?? newest(night)!;
    return { folder, event: eventLine(target, decisions), seg, badges, target: target.id };
  });
}

/** The row's line, from the task it opens: its open decision's question, else its word and title; then the time. */
function eventLine(t: CrewTask, decisions: readonly CrewDecision[]): string {
  const at = clock(activityAt(t));
  const decision = decisions.find((d) => d.task_id === t.id);
  if (decision && t.overnight_word === "needs decision") return `Needs decision: ${decision.summary} ${at}`;
  const title = t.title ?? t.id;
  if (t.overnight_word === "ready") return `Ready to merge: ${title}, ${at}`;
  return `${capitalised(t.overnight_word)}: ${title} ${at}`;
}

/** "since 23:40 yesterday, 9 h 51 m", "since 08:05, 42 m": the start of the night and how long it has been. */
export function sinceCaption(since: number, now: number): string {
  const start = new Date(since);
  const today = new Date(now);
  const sameDay = start.toDateString() === today.toDateString();
  const min = Math.max(0, Math.floor((now - since) / 60_000));
  const span = min < 60 ? `${min} m` : `${Math.floor(min / 60)} h ${min % 60} m`;
  return `since ${clock(since)}${sameDay ? "" : " yesterday"}, ${span}`;
}
