import type { CrewTask, CrewWord } from "../api.ts";
import { elapsedText, largestUnit } from "../crew/board.ts";
import type { SeatedFolder } from "./folders.ts";

// A client folder's crew state in the sidebar (tasks/interface-polish, PRD rules 20–21; build-spec §11.2): pure, from
// the crew's mirror and its words — the board's own, so the sidebar never disagrees with the Crew page. The status bar
// counts the same three words (shell/statusBar.ts), so the bar and the sidebar agree too.

/** The three words a folder can say, most pressing first. */
export type FolderWord = "needs-you" | "failed" | "working";

/** Rule 20's mapping from the crew's words. "in review" (1.12, a task parked on review) is in flight and waits on no
 * one here — it adds nothing to the Inbox's count — so it is working. Done and gone are not in flight. */
const WORD_OF: Partial<Record<CrewWord, FolderWord>> = {
  "needs decision": "needs-you",
  ready: "needs-you",
  failed: "failed",
  blocked: "failed",
  "CI red": "failed",
  queued: "working",
  working: "working",
  "PR open": "working",
  paused: "working",
  unknown: "working",
  "in review": "working",
};

const RANK: Record<FolderWord, number> = { "needs-you": 0, failed: 1, working: 2 };

/** How each word is drawn: its dot (a ring for what needs the captain, DESIGN.md §4) and its words. */
export const FOLDER_WORD: Record<FolderWord, { color: string; kind: "solid" | "ring"; text: (n: number) => string }> = {
  "needs-you": { color: "--warn", kind: "ring", text: (n) => `${n} needs you` },
  failed: { color: "--danger", kind: "solid", text: (n) => `${n} failed` },
  working: { color: "--meter", kind: "solid", text: (n) => `${n} working` },
};

/** Up to three tasks under a folder (rule 21). */
export const FOLDER_TASKS_SHOWN = 3;

export interface FolderTaskLine {
  id: string;
  title: string;
  word: FolderWord;
  /** "41 min", "1 h", "2 d": the elapsed time in its largest unit. */
  elapsed: string;
  /** The full time, for the tooltip: "working 1 h 12 min". */
  elapsedTitle: string;
}

export interface FolderState {
  /** The most pressing word among the folder's tasks in flight, and how many tasks say it. */
  word: FolderWord;
  count: number;
  tasks: FolderTaskLine[];
  /** How many more tasks are in flight than are shown. */
  more: number;
}

/** A task's word in the sidebar, or null when it is not in flight (done, gone, or finished per Rust). */
export function folderWordOf(t: CrewTask): FolderWord | null {
  if (t.finished) return null;
  return WORD_OF[t.word] ?? null;
}

/** When the task started, as the board counts it: its dispatch, else first seen working, else first seen. */
const startOf = (t: CrewTask) => t.dispatched_at ?? t.first_working_at ?? t.first_seen_at;

/** Each shown folder's state, by its path; a folder with nothing in flight is absent. Tasks match a folder by its
 * GitHub repository, as the board's lanes do (never by name); a removed folder is forgotten. */
export function folderStates(tasks: readonly CrewTask[], folders: readonly SeatedFolder[], now: number): Map<string, FolderState> {
  const known = folders.filter((f) => !f.removed && f.repo);
  const byFolder = new Map<string, { t: CrewTask; word: FolderWord }[]>();
  for (const t of tasks) {
    const word = folderWordOf(t);
    const folder = word && t.repo ? known.find((f) => f.repo === t.repo) : undefined;
    if (!word || !folder) continue;
    byFolder.set(folder.path, [...(byFolder.get(folder.path) ?? []), { t, word }]);
  }
  const out = new Map<string, FolderState>();
  for (const [path, list] of byFolder) {
    // Most pressing first, then the longest running.
    list.sort((a, b) => RANK[a.word] - RANK[b.word] || startOf(a.t) - startOf(b.t));
    const word = list[0]!.word;
    out.set(path, {
      word,
      count: list.filter((x) => x.word === word).length,
      tasks: list.slice(0, FOLDER_TASKS_SHOWN).map(({ t, word: w }) => ({
        id: t.id,
        title: t.title ?? t.id,
        word: w,
        elapsed: largestUnit(now - startOf(t)),
        elapsedTitle: elapsedText(t, now) || `seen ${largestUnit(now - t.first_seen_at)} ago`,
      })),
      more: Math.max(0, list.length - FOLDER_TASKS_SHOWN),
    });
  }
  return out;
}

/** The crew's counts over every task in flight, a folder's or not: what the status bar says (rule 24). */
export function crewCounts(tasks: readonly CrewTask[]): Record<FolderWord, number> {
  const counts: Record<FolderWord, number> = { "needs-you": 0, failed: 0, working: 0 };
  for (const t of tasks) {
    const word = folderWordOf(t);
    if (word) counts[word] += 1;
  }
  return counts;
}
