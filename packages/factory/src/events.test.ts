import { expect, test } from "bun:test";
import { eventsFrom, ledgerEventsOf, type AnswerEvent, type LedgerEvent, type View } from "./events.ts";

// build spec §11.4, `events.test.ts`: held once per hold, red once per time a task turns red, answered deliveries, the
// ledger's events copied once. Times in the view are milliseconds; the ledger's `ts` is seconds (Firstmate's own).
const view = (asOf: number, board: [string, string, string][], waiting: [string, string, string, number][] = []): View => ({
  asOf,
  board: board.map(([task, project, word]) => ({ task, project, word })),
  waiting: waiting.map(([key, task, project, since]) => ({ key, task, project, since })),
});
const led = (event: string, task: string, ts: number, project?: string): LedgerEvent => ({ event, task, ts, ...(project ? { project } : {}) });
const names = (es: { event: string }[]) => es.map((e) => e.event);

test("a hold that appears is `held` at the time it began, once: the same hold in the next reading adds nothing", () => {
  const a = view(1_000_000, [["t1", "alpha", "needs decision"]], [["t1@900", "t1", "alpha", 900_000]]);
  const b = view(1_015_000, [["t1", "alpha", "needs decision"]], [["t1@900", "t1", "alpha", 900_000]]);
  expect(eventsFrom(null, a, [], [])).toEqual([{ task: "t1", project: "alpha", event: "held", at: 900_000 }]);
  expect(eventsFrom(a, b, [], [])).toEqual([]);
});

test("a hold gone from the snapshot is `hold_closed` at that reading's time, and a new hold on the same task is a new `held`", () => {
  const a = view(1_000_000, [["t1", "alpha", "needs decision"]], [["t1@900", "t1", "alpha", 900_000]]);
  const gone = view(1_015_000, [["t1", "alpha", "working"]]);
  expect(eventsFrom(a, gone, [], [])).toEqual([{ task: "t1", project: "alpha", event: "hold_closed", at: 1_015_000 }]);
  const again = view(1_030_000, [["t1", "alpha", "needs decision"]], [["t1@1020", "t1", "alpha", 1_020_000]]);
  expect(eventsFrom(gone, again, [], [])).toEqual([{ task: "t1", project: "alpha", event: "held", at: 1_020_000 }]);
});

test("a task that turns blocked, failed or CI red is `red` once; staying red is not told again; turning red again is told again", () => {
  const ok = view(1_000_000, [["t1", "alpha", "working"], ["t2", "beta", "working"], ["t3", "beta", "working"]]);
  const red = view(1_015_000, [["t1", "alpha", "blocked"], ["t2", "beta", "failed"], ["t3", "beta", "CI red"]]);
  expect(eventsFrom(ok, red, [], []).map((e) => `${e.task}:${e.event}@${e.at}`)).toEqual(["t1:red@1015000", "t2:red@1015000", "t3:red@1015000"]);
  const still = view(1_030_000, [["t1", "alpha", "blocked"], ["t2", "beta", "failed"], ["t3", "beta", "CI red"]]);
  expect(eventsFrom(red, still, [], [])).toEqual([]);
  const well = view(1_045_000, [["t1", "alpha", "working"]]);
  const back = view(1_060_000, [["t1", "alpha", "CI red"]]);
  expect(eventsFrom(well, back, [], []).map((e) => e.event)).toEqual(["red"]);
});

test("a task that first appears already in trouble is `red` too", () => {
  expect(eventsFrom(view(1, [["t1", "alpha", "working"]]), view(2, [["t1", "alpha", "working"], ["t9", "beta", "failed"]]), [], []).map((e) => `${e.task}:${e.event}`)).toEqual(["t9:red"]);
});

test("words that are not trouble are not red: needs decision, in review, PR open, paused, done, gone", () => {
  const ok = view(1, [["t", "p", "working"]]);
  for (const word of ["needs decision", "in review", "PR open", "paused", "ready", "done", "gone", "queued", "unknown"]) {
    expect(eventsFrom(ok, view(2, [["t", "p", word]]), [], []), word).toEqual([]);
  }
});

test("the first reading knows no transition: it tells the holds in view, and no red and no close", () => {
  const first = view(1_000_000, [["t1", "alpha", "failed"]], [["t2@5", "t2", "beta", 5_000]]);
  expect(names(eventsFrom(null, first, [], []))).toEqual(["held"]);
});

test("a delivered answer is `answered` at its time", () => {
  const a: AnswerEvent = { task: "t1", project: "alpha", at: 1_100_000 };
  expect(eventsFrom(view(1, []), view(2, []), [], [a])).toEqual([{ task: "t1", project: "alpha", event: "answered", at: 1_100_000 }]);
});

test("the ledger's dispatched, pr_ready, merged and cleaned_up are copied with their time in milliseconds, once each, whatever else the ledger holds", () => {
  const ledger: LedgerEvent[] = [
    led("task.dispatched", "t1", 100, "alpha"),
    led("task.status", "t1", 110),
    led("task.pr_ready", "t1", 200),
    led("task.pr_ready", "t1", 200), // the ledger told twice
    led("task.merged", "t1", 300),
    led("task.cleaned_up", "t1", 310),
    led("task.something_new", "t1", 320),
  ];
  const out = eventsFrom(view(1, []), view(2, []), ledger, []);
  expect(out.map((e) => `${e.event}@${e.at}/${e.project}`)).toEqual(["dispatched@100000/alpha", "pr_ready@200000/alpha", "merged@300000/alpha", "cleaned_up@310000/alpha"]);
});

test("a ledger event's project comes from its own dispatch, else the board, else the previous board, else `unknown`", () => {
  const prev = view(1, [["old", "gamma", "working"]]);
  const next = view(2, [["new", "beta", "working"]]);
  const out = eventsFrom(prev, next, [led("task.merged", "new", 10), led("task.merged", "old", 11), led("task.merged", "stranger", 12), led("task.dispatched", "fresh", 13, "alpha"), led("task.merged", "fresh", 14)], []);
  expect(out.map((e) => `${e.task}:${e.project}`)).toEqual(["new:beta", "old:gamma", "stranger:unknown", "fresh:alpha", "fresh:alpha"]);
});

test("a ledger line's own project wins over the board's", () => {
  const out = eventsFrom(view(1, []), view(2, [["t1", "beta", "working"]]), [led("task.dispatched", "t1", 10, "alpha")], []);
  expect(out.map((e) => e.project)).toEqual(["alpha"]);
});

test("ledgerEventsOf reads a ledger's text, one JSON object a line: a line that is not one, or not version 1, is left out", () => {
  const text = [
    '{"v":1,"ts":100,"event":"task.dispatched","task":"t1","project":"alpha"}',
    "not json",
    '{"v":2,"ts":101,"event":"task.dispatched","task":"t2"}',
    '{"v":1,"ts":"x","event":"task.merged","task":"t1"}',
    '{"v":1,"ts":300,"event":"task.merged","task":"t1"}',
    "",
  ].join("\n");
  expect(ledgerEventsOf(text)).toEqual([
    { event: "task.dispatched", task: "t1", ts: 100, project: "alpha" },
    { event: "task.merged", task: "t1", ts: 300 },
  ]);
});
