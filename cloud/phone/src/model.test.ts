import { expect, test } from "bun:test";
import type { InboxItem, Summary, SummaryTask } from "./model.ts";
import { TABS, TAB_WORDS, ago, deviceName, answerLines, captionOf, codeFromHash, codeTyped, freshness, groupByProject, hhmm, hhmmss, inboxCount, mintRequestId, projectLine, refusalWords, requestFor, taskMeta } from "./model.ts";

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 27, h, m, s).getTime();
const NOW = at(14, 5, 0);
const summary = (asOf: number): Summary => ({ v: 1, asOf, label: "homelab", board: [], waiting: [], counts: { tasks: 0, working: 0, waiting: 0, blocked: 0, inReview: 0 }, usage: { planWeekPct: null, planSessionPct: null }, host: { cpu: 0, memPct: 0, diskPct: 0 }, heartbeatAt: asOf, lanes: null });

test("the four tabs and their words", () => {
  expect(TABS).toEqual(["home", "inbox", "crew", "factory"]);
  expect(TAB_WORDS).toEqual({ home: "Home", inbox: "Inbox", crew: "Crew", factory: "Factory" });
});

test("clocks are 24-hour and two-digit; ages are words", () => {
  expect(hhmm(at(9, 5))).toBe("09:05");
  expect(hhmmss(at(14, 4, 50))).toBe("14:04:50");
  expect(ago(NOW - 20_000, NOW)).toBe("just now");
  expect(ago(NOW - 12 * 60_000, NOW)).toBe("12 min ago");
  expect(ago(NOW - 2 * 3_600_000, NOW)).toBe("2 h ago");
  expect(ago(NOW - 3 * 86_400_000, NOW)).toBe("3 d ago");
});

test("the caption: reading…, fresh with its time, or unreachable since the last beat with the last reading", () => {
  expect(captionOf(freshness(undefined, NOW), "homelab")).toBe("reading…");
  expect(captionOf(freshness({ summary: null, heartbeatAt: null }, NOW), "homelab")).toBe("homelab · nothing read yet");
  expect(captionOf(freshness({ summary: summary(at(14, 4, 50)), heartbeatAt: at(14, 4, 55) }, NOW), "homelab")).toBe("homelab · as of 14:04:50");
  const stale = freshness({ summary: summary(at(14, 1, 10)), heartbeatAt: at(14, 2, 0) }, NOW);
  expect(stale).toEqual({ state: "stale", since: at(14, 2, 0), lastReading: at(14, 1, 10) });
  expect(captionOf(stale, "homelab")).toBe("homelab · unreachable since 14:02 · last reading 14:01");
});

test("fresh until the companion has been silent for over a minute", () => {
  const r = (beat: number) => freshness({ summary: summary(NOW - 5_000), heartbeatAt: beat }, NOW).state;
  expect(r(NOW - 60_000)).toBe("fresh");
  expect(r(NOW - 60_001)).toBe("stale");
  expect(freshness({ summary: summary(1), heartbeatAt: null }, NOW).state).toBe("stale");
});

const answer = (over: Partial<NonNullable<InboxItem["answer"]>>): InboxItem["answer"] => ({ requestId: "r", kind: "approve", status: "delivered", at: at(14, 5), readAt: null, reply: null, ...over });

test("the sheet's lines: sending, delivered, read with its reply", () => {
  expect(answerLines(null)).toEqual({ done: null, read: null, reply: null, error: null, canAnswer: true });
  expect(answerLines(answer({ status: "pending" }))).toMatchObject({ done: "Sending…", canAnswer: false });
  expect(answerLines(answer({}))).toEqual({ done: "Approved — answered from the phone at 14:05.", read: null, reply: null, error: null, canAnswer: false });
  expect(answerLines(answer({ kind: "answer", readAt: at(14, 6), reply: "On it" }))).toEqual({ done: "Answered — answered from the phone at 14:05.", read: "Read by the first mate at 14:06.", reply: "The first mate: On it", error: null, canAnswer: false });
  expect(answerLines(answer({ kind: "deny" })).done).toBe("Denied — answered from the phone at 14:05.");
});

test("an answer found already given or closed has no actions; one that expired can be sent again", () => {
  expect(answerLines(answer({ status: "already" }))).toMatchObject({ error: "Already answered", canAnswer: false });
  expect(answerLines(answer({ status: "not_open" }))).toMatchObject({ error: "No longer waiting", canAnswer: false });
  expect(answerLines(answer({ status: "expired" }))).toMatchObject({ error: "Not delivered in time. Send it again.", canAnswer: true });
  expect(refusalWords({ refused: "unreachable", why: "Not delivered: can't reach the Linux machine" })).toBe("Not delivered: can't reach the Linux machine");
});

test("Send again keeps one request id; any change to the item, the kind or the words makes a new one", () => {
  let n = 0;
  const mint = () => `id-${++n}`;
  const a = requestFor(null, "t@t@1", "answer", "MIT", mint);
  expect(a.id).toBe("id-1");
  expect(requestFor(a, "t@t@1", "answer", "MIT", mint).id).toBe("id-1");
  expect(requestFor(a, "t@t@1", "answer", "Apache", mint).id).toBe("id-2");
  expect(requestFor(a, "t@t@1", "deny", "MIT", mint).id).toBe("id-3");
  expect(requestFor(a, "u@u@1", "answer", "MIT", mint).id).toBe("id-4");
  expect(mintRequestId(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 255]))).toBe("phone-01020304050607ff");
  expect(mintRequestId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
});

test("the pairing code comes from the address or from typing, in Crockford's alphabet", () => {
  expect(codeFromHash("#pair=AB3K9XZQ")).toBe("AB3K9XZQ");
  expect(codeFromHash("pair=ab3k-9xzq")).toBe("AB3K9XZQ");
  expect(codeFromHash("#other=AB3K9XZQ")).toBeNull();
  expect(codeFromHash("#pair=short")).toBeNull();
  expect(codeFromHash("#pair=<script>")).toBeNull();
  expect(codeFromHash("")).toBeNull();
  expect(codeTyped(" ab3k 9xzq ")).toBe("AB3K9XZQ");
  expect(codeTyped("AB3K")).toBeNull();
  expect(codeTyped("AB3K9XZU")).toBeNull();
});

const task = (over: Partial<SummaryTask>): SummaryTask => ({ task: "t", project: "shop", title: "A task", word: "working", kind: "ship", harness: "claude", elapsedS: null, pr: null, checks: null, ...over });

test("the board is a list per project, in name order, with the meta line the mockup draws", () => {
  const groups = groupByProject([task({ task: "a", project: "shop" }), task({ task: "b", project: "harbor-api" }), task({ task: "c", project: "shop" }), task({ task: "d", project: "" })]);
  expect(groups.map((g) => [g.project, g.tasks.map((t) => t.task)])).toEqual([["—", ["d"]], ["harbor-api", ["b"]], ["shop", ["a", "c"]]]);
  expect(taskMeta(task({ elapsedS: 41 * 60, pr: 91, checks: "4/4" }))).toBe("ship · claude · working 41 min · PR #91 4/4");
  expect(taskMeta(task({ elapsedS: 30, harness: null }))).toBe("ship · working under a minute");
  expect(taskMeta(task({ elapsedS: 3 * 3600 + 120, pr: 5 }))).toBe("ship · claude · working 3 h 2 min · PR #5");
});

test("a project's line on Home counts what moves and what waits", () => {
  const g = { project: "shop", tasks: [task({ word: "working" }), task({ word: "working" }), task({ word: "in review" }), task({ word: "CI red" })] };
  const waiting = [{ key: "a@a@1", task: "a", project: "shop", title: "", question: "", recommendation: null, since: 1 }, { key: "b@b@1", task: "b", project: "other", title: "", question: "", recommendation: null, since: 1 }];
  expect(projectLine(g, waiting)).toBe("2 working · 1 waiting on you · 1 in review · 1 need a look");
  expect(projectLine({ project: "idle", tasks: [] }, [])).toBe("Nothing running");
});

test("the Inbox count is what still waits: a delivered answer no longer counts", () => {
  const item = (a: InboxItem["answer"]): InboxItem => ({ key: "k", task: "t", project: "p", title: "", question: "", recommendation: null, since: 1, answer: a });
  expect(inboxCount([item(null), item(answer({ status: "pending" })), item(answer({ status: "delivered" })), item(answer({ status: "expired" }))])).toBe(3);
});

test("a phone is named by its kind, never by its owner", () => {
  expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)")).toBe("iPhone");
  expect(deviceName("Mozilla/5.0 (iPad; CPU OS 17_4)")).toBe("iPad");
  expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android phone");
  expect(deviceName("Mozilla/5.0 (Macintosh)")).toBe("Phone");
});
