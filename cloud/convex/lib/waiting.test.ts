import { expect, test } from "bun:test";
import type { SummaryItem } from "./summary.ts";
import { RETAIN_MS, diffWaiting, inboxOf, retentionCutoff, splitKey } from "./waiting.ts";

const item = (key: string, since = 1): SummaryItem => ({ key, task: key.split("@")[0]!, project: "shop", title: "t", question: "q?", recommendation: null, since });

test("a key the store hasn't seen opens, one the reading dropped closes, one already open does nothing", () => {
  const d = diffWaiting([{ key: "a@a@1" }, { key: "b@b@1" }], [item("b@b@1"), item("c@c@1")]);
  expect(d.open.map((i) => i.key)).toEqual(["c@c@1"]);
  expect(d.close).toEqual(["a@a@1"]);
  expect(d.reopen).toEqual([]);
});

test("a closed item the reading lists again reopens, without being new, so it isn't pushed twice", () => {
  const d = diffWaiting([{ key: "a@a@1", closedAt: 5 }], [item("a@a@1")]);
  expect(d).toEqual({ open: [], close: [], reopen: ["a@a@1"] });
});

test("an item already closed isn't closed again, and a key listed twice opens once", () => {
  expect(diffWaiting([{ key: "a@a@1", closedAt: 5 }], []).close).toEqual([]);
  expect(diffWaiting([], [item("a@a@1"), item("a@a@1")]).open).toHaveLength(1);
});

test("a task asked again is a new item: the opening time is in its key", () => {
  const d = diffWaiting([{ key: "a@a@1", closedAt: 5 }], [item("a@a@9")]);
  expect(d.open.map((i) => i.key)).toEqual(["a@a@9"]);
});

test("splitKey reads the companion's item and nothing else", () => {
  expect(splitKey("fix-login@license@1700000000000")).toEqual({ task: "fix-login", decision: "license", openedAt: 1_700_000_000_000 });
  expect(splitKey("fix-login")).toBeNull();
  expect(splitKey("a@b")).toBeNull();
  expect(splitKey("a@b@c")).toBeNull();
  expect(splitKey("a b@b@1")).toBeNull();
  expect(splitKey("a@b@1@2")).toBeNull();
  expect(splitKey(`${"x".repeat(129)}@b@1`)).toBeNull();
});

test("the inbox is the open items, oldest first, each with its latest answer", () => {
  const rows = [{ ...item("b@b@1", 20) }, { ...item("a@a@1", 10) }, { ...item("gone@gone@1", 5), closedAt: 30 }];
  const answers = [
    { key: "a@a@1", requestId: "r1", kind: "approve" as const, status: "expired" as const, submittedAt: 100, settledAt: 160 },
    { key: "a@a@1", requestId: "r2", kind: "answer" as const, status: "delivered" as const, submittedAt: 200, settledAt: 205, readAt: 300, reply: "On it" },
  ];
  const inbox = inboxOf(rows, answers);
  expect(inbox.map((i) => i.key)).toEqual(["a@a@1", "b@b@1"]);
  expect(inbox[0]!.answer).toEqual({ requestId: "r2", kind: "answer", status: "delivered", at: 205, readAt: 300, reply: "On it" });
  expect(inbox[1]!.answer).toBeNull();
  expect("closedAt" in inbox[0]!).toBe(false);
});

test("retention is thirty days after an item closed", () => {
  expect(RETAIN_MS).toBe(30 * 24 * 3600 * 1000);
  expect(retentionCutoff(RETAIN_MS + 5)).toBe(5);
});
