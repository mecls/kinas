import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryEvent, View } from "@kinas/factory";
import { CloudError, type Cloud } from "./cloud.ts";
import { EVENTS_FILE, appendEvents, chunkSince, freshFactory, loadEvents, tendFactory, viewOf, type FactoryDeps } from "./factory.ts";

// Slice 11.2 (build spec §11.3 B): after each reading the companion derives the factory's events (packages/factory), appends
// the new ones to `events.jsonl` (append-only, each task-event-time once) and sends them to the cloud store, which keeps
// each once. A cloud that fails is told again next time; nothing is ever rewritten or removed.

const T0 = 1_795_700_000_000;
const view = (asOf: number, board: [string, string, string][] = [], waiting: [string, string, string, number][] = []): View => ({
  asOf,
  board: board.map(([task, project, word]) => ({ task, project, word })),
  waiting: waiting.map(([key, task, project, since]) => ({ key, task, project, since })),
});

function world(opts: { ledger?: string | null; answers?: { task: string; project: string; at: number }[]; cloud?: Partial<Cloud> | null } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-factory-")));
  const state = join(root, "state");
  mkdirSync(state, { recursive: true });
  const logs: string[] = [];
  const sent: FactoryEvent[][] = [];
  const ledgerText = { text: opts.ledger ?? null };
  const cursors: ({ epoch: string; offset: number } | null)[] = [];
  const cloud: Cloud | null =
    opts.cloud === null
      ? null
      : ({
          appendFactory: async (events: FactoryEvent[]) => void sent.push(events),
          ...opts.cloud,
        } as Cloud);
  const deps: FactoryDeps = {
    paths: { state },
    cloud,
    log: (l) => logs.push(l),
    ledger: (cursor) => {
      cursors.push(cursor);
      if (ledgerText.text === null) return null;
      const bytes = Buffer.byteLength(ledgerText.text);
      const from = cursor?.epoch === "e1" ? cursor.offset : 0;
      return { epoch: "e1", to: bytes, text: Buffer.from(ledgerText.text).subarray(from).toString("utf8") };
    },
    answers: () => opts.answers ?? [],
  };
  const file = join(state, EVENTS_FILE);
  const lines = () => {
    try {
      return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as FactoryEvent);
    } catch {
      return [];
    }
  };
  return { deps, state, file, logs, sent, lines, ledgerText, cursors };
}

test("viewOf takes the summary's board and waiting items and nothing else", () => {
  const v = viewOf({ asOf: 5, board: [{ task: "t", project: "p", word: "working", title: "x", kind: "ship", harness: null, elapsedS: 1, pr: null, checks: null }], waiting: [{ key: "t@k@1", task: "t", project: "p", title: "x", question: "q", recommendation: null, since: 1 }] });
  expect(v).toEqual({ asOf: 5, board: [{ task: "t", project: "p", word: "working" }], waiting: [{ key: "t@k@1", task: "t", project: "p", since: 1 }] });
});

test("a hold in the first reading is recorded once: the same reading again appends nothing, to the file or to the cloud", async () => {
  const w = world();
  const st = freshFactory();
  const v = view(T0, [["t1", "alpha", "needs decision"]], [["t1@k@900", "t1", "alpha", T0 - 5_000]]);
  await tendFactory(w.deps, v, st);
  await tendFactory(w.deps, v, st);
  expect(w.lines()).toEqual([{ task: "t1", project: "alpha", event: "held", at: T0 - 5_000 }]);
  expect(w.sent).toEqual([[{ task: "t1", project: "alpha", event: "held", at: T0 - 5_000 }]]);
  expect(w.logs).toEqual(["companion: factory 1 new events"]);
});

test("the log only grows: a later reading appends after what is there, and what is there is never rewritten", async () => {
  const w = world();
  const st = freshFactory();
  await tendFactory(w.deps, view(T0, [["t1", "alpha", "working"]]), st);
  await tendFactory(w.deps, view(T0 + 15_000, [["t1", "alpha", "blocked"]]), st);
  const first = readFileSync(w.file, "utf8");
  await tendFactory(w.deps, view(T0 + 30_000, [["t1", "alpha", "working"]], [["t1@k@1", "t1", "alpha", T0 + 20_000]]), st);
  expect(readFileSync(w.file, "utf8").startsWith(first)).toBe(true);
  expect(w.lines().map((e) => e.event)).toEqual(["red", "held"]);
});

test("the fleet ledger's lines become events with their time in milliseconds; a ledger already read is not read again", async () => {
  const ledger = [
    '{"v":1,"ts":1795600000,"event":"task.dispatched","task":"t1","kind":"ship","project":"alpha"}',
    '{"v":1,"ts":1795600500,"event":"task.merged","task":"t1","via":"pr"}',
    "",
  ].join("\n");
  const w = world({ ledger });
  const st = freshFactory();
  await tendFactory(w.deps, view(T0), st);
  expect(w.lines()).toEqual([
    { task: "t1", project: "alpha", event: "dispatched", at: 1795600000000 },
    { task: "t1", project: "alpha", event: "merged", at: 1795600500000 },
  ]);
  w.ledgerText.text = ledger + '{"v":1,"ts":1795601000,"event":"task.cleaned_up","task":"t1"}\n';
  await tendFactory(w.deps, view(T0 + 15_000), st);
  expect(w.lines().map((e) => e.event)).toEqual(["dispatched", "merged", "cleaned_up"]);
  // The second read began where the first ended, not at the start.
  expect(w.cursors).toEqual([null, { epoch: "e1", offset: Buffer.byteLength(ledger) }]);
});

test("no ledger on this machine: no ledger events and no complaint (the factory needs the ledger, PRD rule 20)", async () => {
  const w = world({ ledger: null });
  await tendFactory(w.deps, view(T0, [["t1", "alpha", "working"]]), freshFactory());
  expect(w.lines()).toEqual([]);
  expect(w.logs).toEqual([]);
});

test("a delivered answer is an `answered` event at its time", async () => {
  const w = world({ answers: [{ task: "t1", project: "alpha", at: T0 - 1_000 }] });
  await tendFactory(w.deps, view(T0), freshFactory());
  expect(w.lines()).toEqual([{ task: "t1", project: "alpha", event: "answered", at: T0 - 1_000 }]);
});

test("a restart loads the log, adds nothing it already has, and tells the cloud the whole record again (the cloud keeps each once)", async () => {
  const w = world();
  const v = view(T0, [["t1", "alpha", "needs decision"]], [["t1@k@900", "t1", "alpha", T0 - 5_000]]);
  await tendFactory(w.deps, v, freshFactory());
  const before = readFileSync(w.file, "utf8");
  w.sent.length = 0;
  await tendFactory(w.deps, v, freshFactory()); // a new process: fresh state, the same file
  expect(readFileSync(w.file, "utf8")).toBe(before);
  expect(w.sent).toEqual([[{ task: "t1", project: "alpha", event: "held", at: T0 - 5_000 }]]);
});

test("a cloud that fails keeps the events to send: they are in the file, and go on the next reading", async () => {
  let down = true;
  const w = world({ cloud: { appendFactory: async (events: FactoryEvent[]) => { if (down) throw new CloudError("unreachable"); w2.push(events); } } });
  const w2: FactoryEvent[][] = [];
  const st = freshFactory();
  await tendFactory(w.deps, view(T0, [["t1", "alpha", "needs decision"]], [["t1@k@900", "t1", "alpha", T0 - 5_000]]), st);
  expect(w.lines()).toHaveLength(1);
  expect(w.logs).toContain("companion: cloud failed (unreachable)");
  down = false;
  await tendFactory(w.deps, view(T0 + 15_000, [["t1", "alpha", "needs decision"]], [["t1@k@900", "t1", "alpha", T0 - 5_000]]), st);
  expect(w2).toEqual([[{ task: "t1", project: "alpha", event: "held", at: T0 - 5_000 }]]);
  await tendFactory(w.deps, view(T0 + 30_000, [["t1", "alpha", "needs decision"]], [["t1@k@900", "t1", "alpha", T0 - 5_000]]), st);
  expect(w2).toHaveLength(1); // sent once it got through
});

test("the log line for a failing cloud carries its status or the word error, never the failure's own text", async () => {
  const w = world({ cloud: { appendFactory: async () => { throw new Error("https://secret.convex.cloud refused SECRET"); } } });
  await tendFactory(w.deps, view(T0, [], [["t1@k@1", "t1", "alpha", T0 - 1]]), freshFactory());
  expect(w.logs).toContain("companion: cloud failed (error)");
  expect(w.logs.join("\n")).not.toContain("SECRET");
});

test("a long backlog goes to the cloud in batches of at most 200", async () => {
  const w = world();
  const waiting: [string, string, string, number][] = Array.from({ length: 450 }, (_, i) => [`t${i}@k@${i}`, `t${i}`, "alpha", T0 - 100_000 + i]);
  await tendFactory(w.deps, view(T0, [], waiting), freshFactory());
  expect(w.sent.map((b) => b.length)).toEqual([200, 200, 50]);
  expect(w.lines()).toHaveLength(450);
});

test("with no cloud (a Mac-only setup) the events are still kept in the file", async () => {
  const w = world({ cloud: null });
  await tendFactory(w.deps, view(T0, [], [["t1@k@1", "t1", "alpha", T0 - 1]]), freshFactory());
  expect(w.lines()).toHaveLength(1);
  expect(w.logs).toEqual(["companion: factory 1 new events"]); // and no complaint about a cloud that is not there
});

test("a project over the store's cap is clamped, so one long name cannot make the whole batch refused", async () => {
  const w = world();
  await tendFactory(w.deps, view(T0, [], [["t1@k@1", "t1", "p".repeat(300), T0 - 1]]), freshFactory());
  expect(w.lines()[0]!.project).toHaveLength(100);
});

test("loadEvents skips a line that is not an event, and an unreadable file is no events", () => {
  const w = world();
  writeFileSync(w.file, '{"task":"t","project":"p","event":"merged","at":1795600000000}\nnot json\n{"task":1}\n{"task":"t","project":"p","event":"bogus","at":1795600000000}\n{"task":"t","project":"p","event":"merged","at":1.5}\n');
  expect(loadEvents(w.state)).toEqual([{ task: "t", project: "p", event: "merged", at: 1795600000000 }]);
  expect(loadEvents(join(w.state, "missing"))).toEqual([]);
});

test("appendEvents writes only what is new, each line complete, and says which it wrote", () => {
  const w = world();
  const seen = new Set<string>();
  const a: FactoryEvent = { task: "t", project: "p", event: "merged", at: 1795600000000 };
  expect(appendEvents(w.state, seen, [a, a])).toEqual([a]);
  expect(appendEvents(w.state, seen, [a])).toEqual([]);
  expect(readFileSync(w.file, "utf8")).toBe(`${JSON.stringify(a)}\n`);
});

const ev = (n: number): FactoryEvent => ({ task: `t${n}`, project: "p", event: "merged", at: 1_795_600_000_000 + n });

test("chunkSince: the events after the Mac's count, how many lines that took, and where it began", () => {
  const w = world();
  writeFileSync(w.file, [1, 2, 3].map((n) => `${JSON.stringify(ev(n))}\n`).join(""));
  expect(chunkSince(w.state, 0)).toEqual({ from: 0, taken: 3, events: [ev(1), ev(2), ev(3)] });
  expect(chunkSince(w.state, 2)).toEqual({ from: 2, taken: 1, events: [ev(3)] });
  expect(chunkSince(w.state, 3)).toEqual({ from: 3, taken: 0, events: [] });
});

test("chunkSince: a count past the end of the file means another file, so it starts again at 0", () => {
  const w = world();
  writeFileSync(w.file, `${JSON.stringify(ev(1))}\n`);
  expect(chunkSince(w.state, 5)).toEqual({ from: 0, taken: 1, events: [ev(1)] });
  expect(chunkSince(w.state, -1)).toEqual({ from: 0, taken: 1, events: [ev(1)] }); // never a count below nothing
});

test("chunkSince: no file is nothing to take, and a line that is not an event is counted but not carried", () => {
  const w = world();
  expect(chunkSince(w.state, 0)).toEqual({ from: 0, taken: 0, events: [] });
  writeFileSync(w.file, `${JSON.stringify(ev(1))}\nnot json\n${JSON.stringify(ev(2))}\n`);
  expect(chunkSince(w.state, 0)).toEqual({ from: 0, taken: 3, events: [ev(1), ev(2)] });
  expect(chunkSince(w.state, 1)).toEqual({ from: 1, taken: 2, events: [ev(2)] });
});

test("chunkSince carries at most the cap in one bundle, and the Mac asks again from where it got to", () => {
  const w = world();
  writeFileSync(w.file, Array.from({ length: 5 }, (_, i) => `${JSON.stringify(ev(i))}\n`).join(""));
  expect(chunkSince(w.state, 0, 2)).toEqual({ from: 0, taken: 2, events: [ev(0), ev(1)] });
  expect(chunkSince(w.state, 2, 2)).toEqual({ from: 2, taken: 2, events: [ev(2), ev(3)] });
});
