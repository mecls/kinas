import { describe, expect, test } from "bun:test";
import type { CrewTask, CrewWord } from "../api.ts";
import { seatFolders } from "../shell/folders.ts";
import { BADGE } from "../ui/StatusBadge.tsx";
import { BADGE_OF, cardOrder, duration, elapsedText, laneCounts, lanesOf, metaLine, prLine } from "./board.ts";

// The board's rules (build spec §4 Crew page, PRD rules 18–19, AC-7): lanes by repository in the sidebar's order, then
// the unmatched by name without chips; counts; card order; elapsed texts; PR lines.

const MIN = 60_000;
const NOW = 1_790_000_000_000;

const task = (id: string, word: CrewWord, extra: Partial<CrewTask> = {}): CrewTask => ({
  id,
  title: id,
  repo: null,
  project_name: null,
  kind: "ship",
  word,
  overnight_word: word,
  harness: "claude",
  first_seen_at: NOW - 60 * MIN,
  first_working_at: null,
  done_at: null,
  gone_at: null,
  last_event_at: null,
  last_event_text: null,
  pr: null,
  has_pane: false,
  ...extra,
});

const row = (name: string, repo: string | null, extra = {}) => ({ name, path: `/root/${name}`, display: `~/root/${name}`, category: null, internal: false, hidden: false, removed: false, repo, ...extra });

describe("lanesOf", () => {
  // AC-7: alpha and beta are client folders; gamma is a repository no folder matches; delta's clone has no origin.
  const folders = seatFolders([row("alpha-9c2e", "o/alpha-9c2e"), row("beta-9c2e", "o/beta-9c2e"), row("zeta-9c2e", null)]);
  const tasks = [
    task("a1", "working", { repo: "o/alpha-9c2e" }),
    task("a2", "queued", { repo: "o/alpha-9c2e" }),
    task("b1", "CI red", { repo: "o/beta-9c2e" }),
    task("g1", "working", { repo: "o/gamma-9c2e", project_name: "gamma-9c2e" }),
    task("d1", "working", { project_name: "delta-9c2e" }),
  ];

  test("folders in the sidebar's order with their chips, then the rest by name without chips", () => {
    const lanes = lanesOf(tasks, folders);
    expect(lanes.map((l) => l.name)).toEqual(["alpha-9c2e", "beta-9c2e", "delta-9c2e", "gamma-9c2e"]);
    expect(lanes.map((l) => l.cat === null)).toEqual([false, false, true, true]);
    expect(lanes[0]!.cat).toBe(folders.find((f) => f.name === "alpha-9c2e")!.cat);
    expect(lanes.map((l) => l.repo)).toEqual(["o/alpha-9c2e", "o/beta-9c2e", null, "o/gamma-9c2e"]);
    expect(lanes[0]!.counts).toBe("1 in flight · 1 queued");
  });

  test("matched by repository, never by name; a hidden folder keeps its lane, a removed one is forgotten", () => {
    const named = seatFolders([row("gamma-9c2e", null), row("alpha-9c2e", "o/alpha-9c2e", { hidden: true }), row("beta-9c2e", "o/beta-9c2e", { removed: true })]);
    const lanes = lanesOf(tasks, named);
    expect(lanes.map((l) => [l.name, l.cat !== null])).toEqual([
      ["alpha-9c2e", true],
      ["beta-9c2e", false],
      ["delta-9c2e", false],
      ["gamma-9c2e", false],
    ]);
    expect(lanes.find((l) => l.name === "beta-9c2e")!.key).toBe("repo:o/beta-9c2e");
  });

  test("an internal folder's lane is marked, and follows the others as in the sidebar", () => {
    const withInternal = seatFolders([row("kinas", "o/kinas", { internal: true }), row("alpha-9c2e", "o/alpha-9c2e")]);
    const lanes = lanesOf([task("k", "working", { repo: "o/kinas" }), task("a", "working", { repo: "o/alpha-9c2e" })], withInternal);
    expect(lanes.map((l) => [l.name, l.internal])).toEqual([
      ["alpha-9c2e", false],
      ["kinas", true],
    ]);
  });

  test("a lane exists only while it has a task", () => {
    expect(lanesOf([], folders)).toEqual([]);
  });
});

test("counts in Firstmate's words, only what is not zero", () => {
  expect(laneCounts([task("a", "working"), task("b", "PR open"), task("c", "queued")])).toBe("2 in flight · 1 queued");
  expect(laneCounts([task("a", "queued")])).toBe("1 queued");
  expect(laneCounts([task("a", "done"), task("b", "gone")])).toBe("");
  expect(laneCounts([task("a", "needs decision")])).toBe("1 in flight");
});

test("cards: in flight newest first, then queued, then done, then gone", () => {
  const order = cardOrder([
    task("done", "done", { first_seen_at: NOW }),
    task("old", "working", { first_seen_at: NOW - 30 * MIN }),
    task("gone", "gone"),
    task("q", "queued", { first_seen_at: NOW }),
    task("new", "ready", { first_seen_at: NOW - MIN }),
  ]);
  expect(order.map((t) => t.id)).toEqual(["new", "old", "q", "done", "gone"]);
});

test("elapsed: working since first seen working, done in, or nothing", () => {
  expect(elapsedText(task("a", "working", { first_working_at: NOW - 12 * MIN }), NOW)).toBe("working 12 min");
  expect(elapsedText(task("a", "CI red", { first_working_at: NOW - 72 * MIN }), NOW)).toBe("working 1 h 12 min");
  expect(elapsedText(task("a", "done", { first_working_at: NOW - 60 * MIN, done_at: NOW - 19 * MIN }), NOW)).toBe("done in 41 min");
  expect(elapsedText(task("a", "queued"), NOW)).toBe("");
  expect(elapsedText(task("a", "done", { done_at: NOW }), NOW)).toBe("", "done, never seen working");
  expect(duration(125 * MIN)).toBe("2 h 05 min");
  expect(metaLine(task("a", "queued"), NOW)).toBe("ship · claude");
  expect(metaLine(task("a", "working", { kind: "scout", harness: null, first_working_at: NOW - 3 * MIN }), NOW)).toBe("scout · working 3 min");
});

test("the PR line once gh has answered", () => {
  const pr = { number: 123, state: "OPEN", draft: false, mergeable: "MERGEABLE", checks_total: 4, checks_failed: 1 };
  expect(prLine(null)).toBeNull();
  expect(prLine({ ...pr, state: null, mergeable: null, checks_total: null, checks_failed: null })).toBe("PR #123");
  expect(prLine(pr)).toBe("PR #123 · checks 3/4 · 1 failing");
  expect(prLine({ ...pr, checks_failed: 0 })).toBe("PR #123 · checks 4/4 · mergeable");
  expect(prLine({ ...pr, checks_total: 0, checks_failed: 0, draft: true })).toBe("PR #123 · draft");
  expect(prLine({ ...pr, checks_failed: 0, state: "MERGED" })).toBe("PR #123 · checks 4/4 · merged");
});

test("every word has a badge DESIGN.md draws", () => {
  for (const state of Object.values(BADGE_OF)) expect(BADGE[state]).toBeDefined();
  expect(Object.keys(BADGE_OF)).toHaveLength(12);
});
