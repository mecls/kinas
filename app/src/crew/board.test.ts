import { describe, expect, test } from "bun:test";
import type { CrewTask, CrewWord } from "../api.ts";
import { seatFolders } from "../shell/folders.ts";
import { BADGE } from "../ui/StatusBadge.tsx";
import { BADGE_OF, cardOrder, duration, elapsedText, fleetAsOf, fleetShown, forgetComeBack, laneCounts, lanesOf, metaLine, onScreen, prLine, toStamp } from "./board.ts";

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
  finished: false,
  board_seen_at: null,
  overnight_seen_at: null,
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

test("the fleet caption: as of the snapshot's time, stale past 60 s or stamped in what is now the future", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  expect(fleetAsOf(null, NOW)).toBeNull();
  expect(fleetAsOf(at(NOW - 60_000), NOW)).not.toContain("stale");
  expect(fleetAsOf(at(NOW - 60_001), NOW)).toStartWith("stale · as of ");
  // Made before the clock stepped back two hours: its age is unknown, so it is not fresh (the shared staleness rule).
  expect(fleetAsOf(at(NOW + 120 * MIN), NOW)).toStartWith("stale · as of ");
});

describe("onScreen and toStamp (done work clears, rules 3–5)", () => {
  const OPENED = NOW;
  const none = new Set<string>();
  const done = (id: string, extra: Partial<CrewTask> = {}) => task(id, "done", { finished: true, done_at: NOW - 30 * MIN, ...extra });

  test("onScreen keeps what this load showed and drops what was seen before it", () => {
    const tasks = [
      task("working", "working"),
      done("unseen"),
      done("seen-before", { board_seen_at: OPENED - 1 }),
      done("seen-in-this-load", { board_seen_at: OPENED }),
      done("drawn-then-stamped", { board_seen_at: OPENED - 5 * MIN }),
      done("seen-on-home-only", { overnight_seen_at: OPENED - MIN }),
    ];
    const ids = (list: CrewTask[]) => list.map((t) => t.id);
    expect(ids(onScreen(tasks, "board", OPENED, new Set(["drawn-then-stamped"])))).toEqual(["working", "unseen", "seen-in-this-load", "drawn-then-stamped", "seen-on-home-only"]);
    // Each page clears only what it has shown (rule 6): Overnight drops what Home saw, and keeps the board's.
    expect(ids(onScreen(tasks, "overnight", OPENED, none))).toEqual(["working", "unseen", "seen-before", "seen-in-this-load", "drawn-then-stamped"]);
  });

  test("onScreen counts the stamps this page asked for before a reading holds them", () => {
    // Stamped at the last load, and the page came back before re-reading: the reading still says none.
    const t = done("stamped-here");
    expect(onScreen([t], "board", OPENED, none, new Map([["stamped-here", OPENED - MIN]]))).toEqual([]);
    expect(onScreen([t], "board", OPENED, new Set(["stamped-here"]), new Map([["stamped-here", OPENED - MIN]]))).toEqual([t]);
  });

  test("onScreen clears what this page stamped at an earlier load, whatever the clock read then", () => {
    // The board stamped it, then the Mac's clock stepped back two hours (an NTP correction, a wake): its stamp now
    // reads later than this load's moment. It was seen before this load, so this load leaves it out (rule 5).
    const t = done("before-the-step", { board_seen_at: OPENED + 120 * MIN });
    const asked = new Map([["before-the-step", OPENED + 120 * MIN]]);
    expect(onScreen([t], "board", OPENED, none, asked)).toEqual([]);
    // Drawn in this load, it stays until the next (rule 3).
    expect(onScreen([t], "board", OPENED, new Set(["before-the-step"]), asked)).toEqual([t]);
    // Overnight's own stamp clears on Overnight alone (rule 6).
    const night = done("before-the-step", { overnight_seen_at: OPENED + 120 * MIN });
    expect(onScreen([night], "overnight", OPENED, none, asked)).toEqual([]);
  });

  test("a stamp this page asked for is forgotten once its task comes back, even while the page is hidden (rule 7)", () => {
    // The board showed it done and stamped it; the captain went to Home; Firstmate reopened it (Rust cleared its stamps)
    // and it finished again with a new done_at. Back on Crew, the reading says no stamp — and the page's own memory of
    // the first finish must not clear the second unseen.
    const first = NOW - 30 * MIN;
    const stamped = new Map([["again", OPENED - MIN]]);
    const finishes = new Map<string, number | null>([["again", first]]);
    const refinished = done("again", { done_at: NOW - 5 * MIN });
    forgetComeBack([refinished], stamped, finishes);
    expect(onScreen([refinished], "board", OPENED, none, stamped)).toEqual([refinished]);
    expect([stamped.size, finishes.size]).toEqual([0, 0]);

    // Read unfinished in between: forgotten as well.
    const s2 = new Map([["back", OPENED - MIN]]);
    const f2 = new Map<string, number | null>([["back", first]]);
    forgetComeBack([task("back", "working")], s2, f2);
    expect([s2.size, f2.size]).toEqual([0, 0]);

    // The same finish, or a task this reading does not list: the memory stands, and the card stays cleared.
    const s3 = new Map([["same", OPENED - MIN], ["absent", OPENED - MIN]]);
    const f3 = new Map<string, number | null>([["same", first], ["absent", first]]);
    const same = done("same", { done_at: first });
    forgetComeBack([same], s3, f3);
    expect([...s3.keys()]).toEqual(["same", "absent"]);
    expect(onScreen([same], "board", OPENED, none, s3)).toEqual([]);
  });

  test("a stamp this page asked for is forgotten once Rust drops it: a done task torn down that comes back (rule 7)", () => {
    // The board stamped it; a reading carried Rust's stamp; it was torn down (gone), then returned to the snapshot still
    // done. Rust keeps its done_at and removes its stamps in that write (forget_seen): it is new again, and the page's
    // memory of the first sighting must not clear it unseen.
    const first = NOW - 30 * MIN;
    const stamped = new Map([["back-done", OPENED - MIN]]);
    const finishes = new Map<string, number | null>([["back-done", first]]);
    const confirmed = new Set<string>();
    forgetComeBack([done("back-done", { done_at: first, board_seen_at: OPENED - MIN })], stamped, finishes, "board", confirmed);
    forgetComeBack([done("back-done", { done_at: first, gone_at: NOW - 10 * MIN, board_seen_at: OPENED - MIN })], stamped, finishes, "board", confirmed);
    expect(stamped.has("back-done")).toBe(true);
    const returned = done("back-done", { done_at: first });
    forgetComeBack([returned], stamped, finishes, "board", confirmed);
    expect(onScreen([returned], "board", OPENED, none, stamped)).toEqual([returned]);
    expect([stamped.size, finishes.size, confirmed.size]).toEqual([0, 0, 0]);

    // A reading taken before Rust wrote the stamp still says none: the memory stands until a reading has carried it.
    const s2 = new Map([["not-yet", OPENED - MIN]]);
    const f2 = new Map<string, number | null>([["not-yet", first]]);
    forgetComeBack([done("not-yet", { done_at: first })], s2, f2, "board", new Set());
    expect(onScreen([done("not-yet", { done_at: first })], "board", OPENED, none, s2)).toEqual([]);
    // Overnight's stamp says nothing of the board's memory (rule 6).
    const s3 = new Map([["other", OPENED - MIN]]);
    const f3 = new Map<string, number | null>([["other", first]]);
    const c3 = new Set<string>();
    forgetComeBack([done("other", { done_at: first, overnight_seen_at: OPENED - MIN })], s3, f3, "board", c3);
    forgetComeBack([done("other", { done_at: first })], s3, f3, "board", c3);
    expect(s3.has("other")).toBe(true);
  });

  test("onScreen never drops an unfinished task", () => {
    // A done task whose PR is still open is not finished (Rust's word): whatever its stamp says, it stays.
    const open = task("pr-open", "done", { finished: false, board_seen_at: OPENED - MIN, overnight_seen_at: OPENED - MIN });
    const failed = task("failed", "failed", { board_seen_at: OPENED - MIN });
    expect(onScreen([open, failed], "board", OPENED, none)).toEqual([open, failed]);
    expect(onScreen([open, failed], "overnight", OPENED, none)).toEqual([open, failed]);
  });

  test("toStamp gives the finished tasks with no stamp for the surface", () => {
    const shown = [task("working", "working"), done("unseen"), done("stamped", { board_seen_at: OPENED }), done("home-only", { overnight_seen_at: OPENED }), task("gone", "gone", { finished: true })];
    expect(toStamp(shown, "board")).toEqual(["unseen", "home-only", "gone"]);
    expect(toStamp(shown, "overnight")).toEqual(["unseen", "stamped", "gone"]);
  });
});

describe("fleetShown (done work clears, rule 4: seen means drawn)", () => {
  test("the Fleet section exists while the first mate runs, or while there is a card or a reader error to draw", () => {
    expect(fleetShown("running", 0, false)).toBe(true);
    expect(fleetShown("installed", 1, false)).toBe(true);
    expect(fleetShown("installed", 0, true)).toBe(true);
    expect(fleetShown("installed", 0, false)).toBe(false);
  });

  test("before setup the page is the setup line and the tools: no card is drawn, so no finished task is seen there", () => {
    // The mirror keeps every task (rule 11), so a finished one can be in the reading while the clone is gone; the page
    // must not stamp it as seen on the board it is not drawing.
    expect(fleetShown("uninstalled", 3, false)).toBe(false);
    expect(fleetShown("uninstalled", 0, true)).toBe(false);
    expect(fleetShown(undefined, 3, false)).toBe(false);
  });
});

describe("the Work page chrome's badge (first-mate PRD rule 24)", () => {
  test("a worker's pane wears its task's word, every word the board draws", async () => {
    const { paneBadge } = await import("./board.ts");
    // failed, paused, unknown and gone were left out of the chrome's own table, so those workers wore no badge.
    expect(paneBadge({ word: "paused", stale: false })).toBe("paused");
    expect(paneBadge({ word: "failed", stale: false })).toBe("failed");
    expect(paneBadge({ word: "unknown", stale: false })).toBe("unknown");
    expect(paneBadge({ word: "working", stale: false })).toBe("working");
    expect(paneBadge({ word: "CI red", stale: false })).toBe("red");
  });

  test("no badge from a guess: the first mate's pane, a shell, a stale view of Herdr", async () => {
    const { paneBadge } = await import("./board.ts");
    expect(paneBadge({ word: null, stale: false })).toBeUndefined();
    expect(paneBadge({ word: "working", stale: true })).toBeUndefined();
    expect(paneBadge(null)).toBeUndefined();
  });

  test("the Work page draws it from here, not from a table of its own", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const work = readFileSync(join(import.meta.dir, "..", "pages", "Work.tsx"), "utf8");
    expect(work).toMatch(/paneBadge\(pane\)/);
    expect(work.includes("Partial<Record<CrewWord")).toBe(false);
  });
});
