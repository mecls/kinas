import { describe, expect, test } from "bun:test";
import type { CrewTask } from "../api.ts";
import type { SeatedFolder } from "./folders.ts";
import { crewCounts, FOLDER_TASKS_SHOWN, folderStates, folderWordOf } from "./folderState.ts";

const NOW = 1_790_000_000_000;
const MIN = 60_000;

const folder = (name: string, repo: string | null, extra: Partial<SeatedFolder> = {}): SeatedFolder => ({
  name,
  path: `/root/${name}`,
  display: `~/${name}`,
  category: null,
  internal: false,
  hidden: false,
  removed: false,
  repo,
  cat: 1,
  ...extra,
});

const task = (id: string, word: CrewTask["word"], minutesAgo: number, extra: Partial<CrewTask> = {}): CrewTask =>
  ({
    id,
    title: `Task ${id}`,
    repo: "o/acme",
    project_name: null,
    kind: "ship",
    word,
    overnight_word: word,
    harness: null,
    first_seen_at: NOW - minutesAgo * MIN,
    first_working_at: NOW - minutesAgo * MIN,
    done_at: null,
    gone_at: null,
    finished: false,
    dispatched_at: null,
    merged_at: null,
    ...extra,
  }) as CrewTask;

const FOLDERS = [folder("acme", "o/acme"), folder("globex", "o/globex"), folder("plain", null)];

describe("folderStates (rules 20–21)", () => {
  test("most pressing word: needs decision beside working is needs you, count 1; CI red beside working is failed", () => {
    const states = folderStates([task("a", "needs decision", 12), task("b", "working", 41)], FOLDERS, NOW);
    expect(states.get("/root/acme")).toMatchObject({ word: "needs-you", count: 1 });
    const red = folderStates([task("c", "working", 5, { repo: "o/globex" }), task("d", "CI red", 3, { repo: "o/globex" })], FOLDERS, NOW);
    expect(red.get("/root/globex")).toMatchObject({ word: "failed", count: 1 });
    expect(red.has("/root/acme")).toBe(false);
  });

  test("three then more: five in flight show three, the most pressing first, then the longest running; more is 2", () => {
    const tasks = [task("w1", "working", 10), task("w2", "working", 90), task("q", "queued", 2), task("n", "needs decision", 41), task("p", "PR open", 72)];
    const state = folderStates(tasks, FOLDERS, NOW).get("/root/acme")!;
    expect(state.tasks.map((t) => [t.id, t.word, t.elapsed])).toEqual([
      ["n", "needs-you", "41 min"],
      ["w2", "working", "1 h"],
      ["p", "working", "1 h"],
    ]);
    expect(state.tasks).toHaveLength(FOLDER_TASKS_SHOWN);
    expect(state.more).toBe(2);
    expect(state.tasks[1]!.elapsedTitle).toBe("working 1 h 30 min");
  });

  test("done and gone never listed; a folder with nothing in flight is absent", () => {
    const tasks = [task("d", "done", 60, { finished: true }), task("g", "gone", 60, { finished: true }), task("o", "done", 60)];
    expect(folderStates(tasks, FOLDERS, NOW).size).toBe(0);
    expect(folderWordOf(task("o", "done", 1))).toBeNull();
  });

  test("matched by repository, never by name; a removed folder and a task with no repository are left out", () => {
    const tasks = [task("x", "working", 5, { repo: null, project_name: "acme" }), task("y", "working", 5, { repo: "o/beta" })];
    expect(folderStates(tasks, FOLDERS, NOW).size).toBe(0);
    const removed = [folder("acme", "o/acme", { removed: true })];
    expect(folderStates([task("a", "working", 5)], removed, NOW).size).toBe(0);
  });

  test("in review is working (it waits on no one here); the dispatch time starts the clock when the ledger kept one", () => {
    const state = folderStates([task("r", "in review", 5, { dispatched_at: NOW - 3 * 60 * MIN })], FOLDERS, NOW).get("/root/acme")!;
    expect(state).toMatchObject({ word: "working", count: 1 });
    expect(state.tasks[0]!.elapsed).toBe("3 h");
  });
});

describe("crewCounts", () => {
  test("every task in flight, a folder's or not, by the same three words", () => {
    const tasks = [task("a", "needs decision", 1), task("b", "ready", 1, { repo: null }), task("c", "blocked", 1), task("d", "working", 1), task("e", "done", 1, { finished: true })];
    expect(crewCounts(tasks)).toEqual({ "needs-you": 2, failed: 1, working: 1 });
  });
});
