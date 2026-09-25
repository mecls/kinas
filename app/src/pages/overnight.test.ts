import { expect, test } from "bun:test";
import type { CrewDecision, CrewTask, CrewWord } from "../api.ts";
import { seatFolders } from "../shell/folders.ts";
import { bucketOf, overnightRows, sinceCaption } from "./overnight.ts";

// Home's Overnight (build spec §11.4 overnight.test.ts): only in-window tasks counted; buckets per §7; gone-then-done
// counts as done; the most important target; the caption.

const H = 3_600_000;
const NOW = new Date(2026, 8, 25, 9, 31).getTime();
const SINCE = new Date(2026, 8, 24, 23, 40).getTime();

const row = (name: string, repo: string | null) => ({ name, path: `/root/${name}`, display: `~/root/${name}`, category: null, internal: false, hidden: false, removed: false, repo });
const folders = seatFolders([row("harbor-9c2e", "o/harbor-9c2e"), row("north-9c2e", "o/north-9c2e")]);

const task = (id: string, word: CrewWord, at: number, extra: Partial<CrewTask> = {}): CrewTask => ({
  id,
  title: `${id} title`,
  repo: "o/harbor-9c2e",
  project_name: "harbor-9c2e",
  kind: "ship",
  word,
  overnight_word: word,
  harness: "claude",
  first_seen_at: at - H,
  first_working_at: null,
  done_at: null,
  gone_at: null,
  last_event_at: at,
  last_event_text: word,
  pr: null,
  has_pane: false,
  ...extra,
});

test("buckets per §7", () => {
  expect((["done"] as CrewWord[]).map(bucketOf)).toEqual(["done"]);
  expect((["queued", "working", "PR open", "paused", "unknown"] as CrewWord[]).map(bucketOf)).toEqual(Array(5).fill("working"));
  expect((["needs decision", "ready"] as CrewWord[]).map(bucketOf)).toEqual(["wait", "wait"]);
  expect((["failed", "blocked", "CI red"] as CrewWord[]).map(bucketOf)).toEqual(["fail", "fail", "fail"]);
});

test("only in-window tasks count; the waiting one is the target; a quiet folder has nothing", () => {
  const decisions: CrewDecision[] = [{ task_id: "a", key: "api", verb: "needs-decision", summary: "REST or GraphQL?", task_title: "a title", repo: "o/harbor-9c2e", opened_at: NOW - H, copied_at: null }];
  const tasks = [
    task("a", "needs decision", NOW - 4 * H),
    task("b", "CI red", NOW - 2 * H),
    task("c", "working", NOW - H),
    task("old", "done", SINCE - H, { done_at: SINCE - H, first_seen_at: SINCE - 5 * H }),
    task("gone", "gone", NOW - 3 * H, { overnight_word: "done", done_at: NOW - 3 * H }),
  ];
  const [harbor, north] = overnightRows(folders, tasks, SINCE, decisions);
  expect(harbor!.seg).toEqual({ done: 1, working: 1, wait: 1, fail: 1 });
  expect(harbor!.badges).toEqual([
    { state: "decision", count: 1 },
    { state: "red", count: 1 },
    { state: "working", count: 1 },
    { state: "done", count: 1 },
  ]);
  expect(harbor!.target).toBe("a");
  expect(harbor!.event).toMatch(/^Needs decision: REST or GraphQL\? \d\d:\d\d$/);
  expect(north).toEqual({ folder: folders[1]!, event: null, seg: null, badges: [], target: null });
});

test("with nothing waiting, a failed one leads; then the latest", () => {
  const [failed] = overnightRows(folders, [task("w", "working", NOW - H), task("f", "blocked", NOW - 3 * H)], SINCE);
  expect(failed!.target).toBe("f");
  const [latest] = overnightRows(folders, [task("w1", "working", NOW - 3 * H), task("w2", "done", NOW - H, { done_at: NOW - H })], SINCE);
  expect(latest!.target).toBe("w2");
  expect(latest!.event).toMatch(/^Done: w2 title \d\d:\d\d$/);
  const [ready] = overnightRows(folders, [task("r", "ready", NOW - H)], SINCE);
  expect(ready!.event).toMatch(/^Ready to merge: r title, \d\d:\d\d$/);
});

test("the caption says where the night began and how long ago", () => {
  expect(sinceCaption(SINCE, NOW)).toBe("since 23:40 yesterday, 9 h 51 m");
  expect(sinceCaption(NOW - 42 * 60_000, NOW)).toBe(`since ${new Date(NOW - 42 * 60_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}, 42 m`);
});
