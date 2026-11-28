import { expect, test } from "bun:test";
import { EVENTS, H, MON, PLAN, SPANS, at, ev } from "./scenario.ts";
import { inDay, median, p90, week, weekStart, weeks } from "./week.ts";

test("weekStart: Monday 00:00 Lisbon, in winter and in summer, and the end of a Sunday night", () => {
  expect(weekStart(at(2, 15))).toBe(MON);
  expect(weekStart(MON)).toBe(MON);
  expect(weekStart(MON - 1)).toBe(MON - 7 * 24 * H);
  expect(weekStart(at(6, 23, 59))).toBe(MON);
  // Summer, UTC+1: Mon 6 Jul 2026 00:00 Lisbon is Sun 5 Jul 23:00 UTC.
  expect(weekStart(Date.UTC(2026, 6, 8, 12))).toBe(Date.UTC(2026, 6, 5, 23));
});

test("the week that holds the clocks going back is 169 hours, the one that holds them going forward 167", () => {
  const back = weekStart(Date.UTC(2026, 9, 20)); // Mon 19 Oct 2026 00:00 Lisbon = Sun 18 Oct 23:00 UTC
  expect(back).toBe(Date.UTC(2026, 9, 18, 23));
  expect(week([], [], [], back).end - back).toBe(169 * H);
  const fwd = weekStart(Date.UTC(2026, 2, 24)); // Mon 23 Mar 2026 00:00 Lisbon (UTC+0); the clocks went forward Sun 29 Mar
  expect(week([], [], [], fwd).end - fwd).toBe(167 * H);
});

test("inDay is 09:00 up to, not including, 21:00 Lisbon time", () => {
  expect(inDay(at(0, 8, 59))).toBe(false);
  expect(inDay(at(0, 9))).toBe(true);
  expect(inDay(at(0, 20, 59))).toBe(true);
  expect(inDay(at(0, 21))).toBe(false);
  expect(inDay(Date.UTC(2026, 6, 6, 7, 59))).toBe(false); // 08:59 Lisbon in summer
  expect(inDay(Date.UTC(2026, 6, 6, 8, 0))).toBe(true); // 09:00 Lisbon in summer
});

test("median and the 90th percentile (nearest rank): none for no values", () => {
  expect(median([])).toBeNull();
  expect(median([5])).toBe(5);
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 2, 4, 12, 24, 120])).toBe(8);
  expect(p90([])).toBeNull();
  expect(p90([1, 2, 4, 12, 24, 120])).toBe(120);
  expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
});

test("the week by hand: what merged, and the week before", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  expect(w.start).toBe(MON);
  expect(w.end).toBe(MON + 7 * 24 * H);
  expect(w.merged).toBe(6); // a1 a2 a3 a4 b1 b2
  expect(w.mergedPrev).toBe(1); // p1
});

test("cycle time is dispatch to merge: median 8 h and p90 120 h over six tasks", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  expect(w.cycle.median).toEqual({ value: 8 * H, n: 6 });
  expect(w.cycle.p90).toEqual({ value: 120 * H, n: 6 });
});

test("waiting on you: three answered holds begun in the day (30 min, 60 min, 90 min), the longest 9 h, four questions", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  expect(w.waiting.median).toEqual({ value: 60 * 60_000, n: 3 });
  expect(w.waiting.longest).toEqual({ value: 9 * H, n: 4 });
  expect(w.waiting.questions).toBe(4);
});

test("needed you, went red and away are shares, over the merged (or finished) tasks", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  expect(w.neededYou).toEqual({ value: 3 / 6, n: 6 }); // a1 a2 a3 of the six merged
  expect(w.wentRed).toEqual({ value: 2 / 7, n: 7 }); // finished: the six merged and d1; red: a2 and d1
  expect(w.away).toEqual({ value: 2 / 6, n: 6 }); // b1 and b2
});

test("tokens per merged task: the median of each task's total, from the tasks that have any", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  expect(w.tokensPerTask).toEqual({ value: 400, n: 3 }); // 150, 400, 1000
});

test("the plan's peak is the week's highest reading, and none without a reading", () => {
  expect(week(EVENTS, SPANS, PLAN, MON).planPeak).toBe(62);
  expect(week(EVENTS, SPANS, [], MON).planPeak).toBeNull();
});

test("by project: alpha has four merged, beta two; a figure with fewer than three behind it is none", () => {
  const w = week(EVENTS, SPANS, PLAN, MON);
  const alpha = w.byProject.find((p) => p.project === "alpha")!;
  const beta = w.byProject.find((p) => p.project === "beta")!;
  expect(w.byProject.map((p) => p.project)).toEqual(["alpha", "beta", "gamma"]);
  expect(alpha.merged).toBe(4);
  expect(alpha.cycle.median).toEqual({ value: 18 * H, n: 4 }); // 2, 12, 24, 120 h
  expect(alpha.cycle.p90).toEqual({ value: 120 * H, n: 4 });
  expect(beta.merged).toBe(2);
  expect(beta.cycle.median).toEqual({ value: null, n: 2 });
  expect(beta.cycle.p90).toEqual({ value: null, n: 2 });
  expect(beta.away).toEqual({ value: null, n: 2 });
});

test("a week with no events: counts are zero, every figure is none with n 0", () => {
  const w = week([], [], [], MON);
  expect(w.merged).toBe(0);
  expect(w.cycle.median).toEqual({ value: null, n: 0 });
  expect(w.waiting.questions).toBe(0);
  expect(w.neededYou).toEqual({ value: null, n: 0 });
  expect(w.planPeak).toBeNull();
  expect(w.byProject).toEqual([]);
});

test("a hold nobody has answered or closed yet is not a wait, and a merged task counts once however often it is told of", () => {
  const open = [...EVENTS, ev("e1", "alpha", "dispatched", at(4, 9)), ev("e1", "alpha", "held", at(4, 10))];
  expect(week(open, SPANS, PLAN, MON).waiting.questions).toBe(4);
  const twice = [...EVENTS, ev("a1", "alpha", "merged", at(0, 12))]; // the same event again
  expect(week(twice, SPANS, PLAN, MON).merged).toBe(6);
});

test("a hold ends at the first answer before the next hold: an unanswered one is not borrowed an answer that belongs to a later one", () => {
  const two = [...EVENTS, ev("f1", "alpha", "dispatched", at(4, 9)), ev("f1", "alpha", "held", at(4, 10)), ev("f1", "alpha", "held", at(4, 12)), ev("f1", "alpha", "answered", at(4, 13))];
  const w = week(two, SPANS, PLAN, MON);
  expect(w.waiting.questions).toBe(5); // the four, and the second hold of f1 (60 min); its first is still open
  expect(w.waiting.median).toEqual({ value: 60 * 60_000, n: 4 }); // 30, 60, 60, 90 min
});

test("an event told twice (the same task, event and time) is counted once: holds, answers and tokens", () => {
  const twice = [...EVENTS, ev("a1", "alpha", "held", at(0, 10, 30)), ev("a1", "alpha", "answered", at(0, 11)), ev("a2", "alpha", "tokens", at(0, 23), 400)];
  const w = week(twice, SPANS, PLAN, MON);
  expect(w.waiting.questions).toBe(4);
  expect(w.tokensPerTask).toEqual({ value: 400, n: 3 }); // a2 is still 400, not 800
});

test("weeks: the last N weeks, oldest first, each as its own week", () => {
  const ws = weeks(EVENTS, SPANS, PLAN, MON, 2);
  expect(ws.map((w) => w.start)).toEqual([MON - 7 * 24 * H, MON]);
  expect(ws[0]!.merged).toBe(1);
  expect(ws[1]!.merged).toBe(6);
});
