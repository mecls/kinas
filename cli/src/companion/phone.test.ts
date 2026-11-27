import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_FILE, answersFile, tendReceipts, type AnswerDeps, type QuestionOut } from "./answer.ts";
import { CloudError, type Cloud, type PendingAnswer } from "./cloud.ts";
import type { FmCall, ScriptOut } from "./firstmate.ts";
import { companionPaths } from "./paths.ts";
import { freshPhone, tendPhone } from "./phone.ts";

// Slice 10.2 (build spec §11.3 D): the companion takes a phone's answers from the store every five seconds, delivers each
// as the same note the Mac's answer is, and tells the store what became of it, then what the first mate did with it.

const T0 = 1_795_700_000_000;
const TASK = "t1-9c2e";
const KEY = "api-shape-9c2e";
const ITEM = `${TASK}@${KEY}@${T0 - 60_000}`;
const out = (exit: number | null, stdout = ""): ScriptOut => ({ exit, timed_out: exit === null, stdout, stderr_first: null });
const snapshot = JSON.stringify({
  schema: "fm-fleet-snapshot.v1",
  backlog: { records: [{ structured: true, id: TASK, state: "in_flight", captain_actionable: false }] },
  tasks: [{ id: TASK, hints: { open_decisions: [{ key: KEY, verb: "needs-decision", summary: "which shape?" }] } }],
});
const noteJson = (outcome: "created" | "replay") => JSON.stringify({ schema: "fm-inbox-note.v1", outcome, id: "1795700000-abc", request_id: "kinas-p1", saved: true, announced: true, acknowledged: false, path: "/x/1.note" });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-phone-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  const calls: { script: string; args: string[]; stdin?: string }[] = [];
  const logs: string[] = [];
  const now = { t: T0 };
  const fm = { snapshot: out(0, snapshot), hold: out(1), note: out(0, noteJson("created")), receipts: out(0, JSON.stringify({ schema: "fm-inbox-receipts.v1", pending: [], handled: [] })) };
  const answer: AnswerDeps = {
    paths,
    fm: {
      run: async (call: FmCall) => {
        calls.push({ script: call.script, args: [...call.args], ...("stdin" in call ? { stdin: call.stdin } : {}) });
        if (call.script === "fm-fleet-snapshot.sh") return fm.snapshot;
        if (call.script === "fm-captain-hold.sh") return fm.hold;
        if (call.script === "fm-inbox.sh" && call.args[0] === "note") return fm.note;
        if (call.script === "fm-inbox.sh" && call.args[0] === "receipts") return fm.receipts;
        throw new Error(`unexpected ${call.script}`);
      },
    },
    clock: () => now.t,
    log: (l) => logs.push(l),
    sleep: async () => {},
  };
  mkdirSync(paths.state, { recursive: true });
  const q: QuestionOut[] = [{ task: TASK, key: KEY, hold: false, opened_at: T0 - 60_000 }];
  writeFileSync(paths.reading, JSON.stringify({ v: 1, at: T0 - 15_000, questions: q }));
  const store = { pending: [] as PendingAnswer[], settled: [] as string[], failTake: false, failSettle: false };
  const cloud: Cloud = {
    replaceReading: async () => {},
    heartbeat: async () => {},
    takeAnswers: async () => {
      if (store.failTake) throw new CloudError("unreachable");
      return store.pending;
    },
    settleAnswer: async (id, outcome, at, reply) => {
      if (store.failSettle) throw new CloudError("unreachable");
      store.settled.push(`${id} ${outcome} ${at}${reply === undefined ? "" : ` ${reply}`}`);
      if (outcome !== "read") store.pending = store.pending.filter((p) => p.requestId !== id);
    },
    startPairing: async () => {},
    phones: async () => [],
    unpair: async () => {},
    testNotification: async () => {},
  };
  const phone = (over: Partial<PendingAnswer> = {}): PendingAnswer => ({ requestId: "phone-p1", key: ITEM, task: TASK, decision: KEY, kind: "approve", text: "", submittedAt: T0 - 5_000, ...over });
  const state = freshPhone();
  const tick = () => tendPhone({ cloud, answer, clock: () => now.t, log: (l) => logs.push(l) }, state);
  return { root, paths, calls, logs, now, fm, store, phone, tick, answer };
}

const receipts = (pending: object[], handled: object[]) => JSON.stringify({ schema: "fm-inbox-receipts.v1", home: "x/firstmate", pending, handled, replies: [], omitted: [] });
const rnote = (request_id: string, reply: object | null = null) => ({ id: "n", at: "2026-11-26T10:00:00Z", source: "text", request_id, body: "words stay on the machine", acknowledged: false, announced: true, reply });

const noteCalls = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.script === "fm-inbox.sh" && c.args[0] === "note");

test("a phone's Approve is delivered as the same note the Mac's is, and the store is told it was delivered", async () => {
  const w = world();
  w.store.pending = [w.phone()];
  await w.tick();
  expect(noteCalls(w)).toHaveLength(1);
  expect(noteCalls(w)[0]!.stdin).toBe(`On ${TASK} (${KEY}): Approved — go ahead.`);
  expect(noteCalls(w)[0]!.args).toEqual(["note", "--request-id", "kinas-phone-p1", "--json", "-"]);
  expect(w.store.settled).toEqual([`phone-p1 delivered ${T0}`]);
});

test("an Answer carries the typed words and a Deny its reason, in the line the Mac would build", async () => {
  const w = world();
  w.store.pending = [w.phone({ kind: "answer", text: "  REST  ", requestId: "phone-a" })];
  await w.tick();
  const d = world();
  d.store.pending = [d.phone({ kind: "deny", text: "not before Monday", requestId: "phone-b" })];
  await d.tick();
  expect(noteCalls(w).map((c) => c.stdin)).toEqual([`On ${TASK} (${KEY}): REST`]);
  expect(noteCalls(d).map((c) => c.stdin)).toEqual([`On ${TASK} (${KEY}): Denied — not before Monday`]);
  // One answer per item: a second, different one is refused as already answered, and writes nothing.
  w.store.pending = [w.phone({ kind: "deny", text: "no", requestId: "phone-c" })];
  await w.tick();
  expect(noteCalls(w)).toHaveLength(1);
  expect(w.store.settled.at(-1)).toBe(`phone-c already ${T0}`);
});

test("an answer over a minute old is expired and writes nothing to Firstmate", async () => {
  const w = world();
  w.store.pending = [w.phone({ submittedAt: T0 - 60_001 })];
  await w.tick();
  expect(w.calls).toEqual([]);
  expect(w.store.settled).toEqual([`phone-p1 expired ${T0}`]);
  w.store.pending = [w.phone({ requestId: "phone-q", submittedAt: T0 - 60_000 })];
  await w.tick();
  expect(noteCalls(w)).toHaveLength(1);
});

test("a question already closed is not_open; one answered already (from the Mac) is already; no note either way", async () => {
  const w = world();
  w.fm.snapshot = out(0, JSON.stringify({ schema: "fm-fleet-snapshot.v1", backlog: { records: [] }, tasks: [] }));
  w.store.pending = [w.phone()];
  await w.tick();
  expect(w.store.settled).toEqual([`phone-p1 not_open ${T0}`]);
  expect(noteCalls(w)).toHaveLength(0);

  const m = world();
  m.store.pending = [m.phone({ requestId: "mac-then-phone" })];
  // The Mac answered this item first: its row is in the companion's own record.
  writeFileSync(answersFile(m.paths), `${JSON.stringify({ v: 1, t: "outcome", request_id: "mac-1", item: ITEM, task: TASK, key: KEY, from: "mac", at: T0 - 10_000, outcome: "delivered", woken: true, replay: false })}\n`);
  await m.tick();
  expect(m.store.settled).toEqual([`mac-then-phone already ${T0}`]);
  expect(noteCalls(m)).toHaveLength(0);
});

test("a refusal (the sandbox gate, a question Firstmate can't tell about) says not delivered, so the phone can send again", async () => {
  const w = world();
  w.fm.snapshot = out(null);
  w.store.pending = [w.phone()];
  await w.tick();
  expect(w.store.settled).toEqual([`phone-p1 expired ${T0}`]);
  expect(noteCalls(w)).toHaveLength(0);
});

test("a cloud that fails is a status in the log, and nothing is delivered or lost", async () => {
  const w = world();
  w.store.pending = [w.phone()];
  w.store.failTake = true;
  await w.tick();
  expect(w.logs).toContain("companion: cloud failed (unreachable)");
  expect(w.calls).toEqual([]);
  w.store.failTake = false;
  await w.tick();
  expect(noteCalls(w)).toHaveLength(1);
});

test("a note saved but not reported is reported on the next tick, and is still one note", async () => {
  const w = world();
  w.store.pending = [w.phone()];
  w.store.failSettle = true;
  await w.tick();
  expect(noteCalls(w)).toHaveLength(1);
  expect(w.store.settled).toEqual([]);
  expect(w.logs).toContain("companion: cloud failed (unreachable)");
  w.store.failSettle = false;
  w.fm.note = out(0, noteJson("replay"));
  await w.tick();
  expect(w.store.settled).toEqual([`phone-p1 delivered ${T0}`]);
  expect(readFileSync(answersFile(w.paths), "utf8").split("\n").filter((l) => l.includes('"outcome"')).length).toBeGreaterThanOrEqual(1);
});

test("once the first mate reads the note, and again once it replies, the store is told, each once", async () => {
  const w = world();
  w.store.pending = [w.phone()];
  await w.tick();
  expect(w.store.settled).toHaveLength(1);
  w.now.t = T0 + 20_000;
  w.fm.receipts = out(0, receipts([], [rnote("kinas-phone-p1")]));
  await tendReceipts(w.answer);
  await w.tick();
  await w.tick();
  expect(w.store.settled.slice(1)).toEqual([`phone-p1 read ${T0 + 20_000}`]);
  w.now.t = T0 + 40_000;
  w.fm.receipts = out(0, receipts([], [rnote("kinas-phone-p1", { at: "2026-11-26T10:05:00Z", body: "On it" })]));
  await tendReceipts(w.answer);
  await w.tick();
  await w.tick();
  expect(w.store.settled.slice(2)).toEqual([`phone-p1 read ${T0 + 20_000} On it`]);
});

test("the Mac's answers are never sent to the store, and the typed words are in no log line or settle", async () => {
  const w = world();
  const secret = "secret-words-7f3a";
  w.store.pending = [w.phone({ kind: "answer", text: secret })];
  await w.tick();
  expect(w.logs.join("\n")).not.toContain(secret);
  expect(w.store.settled.join("\n")).not.toContain(secret);
  // A row from the Mac, delivered and read: nothing about it reaches the store.
  const m = world();
  writeFileSync(answersFile(m.paths), `${JSON.stringify({ v: 1, t: "outcome", request_id: "mac-1", item: ITEM, task: TASK, key: KEY, from: "mac", at: T0, outcome: "delivered", woken: true, replay: false })}\n${JSON.stringify({ v: 1, t: "read", request_id: "mac-1", at: T0 + 5 })}\n`);
  await m.tick();
  expect(m.store.settled).toEqual([]);
  expect(existsSync(answersFile(m.paths))).toBe(true);
});

test("while another answer is being sent the answer stays pending, then goes on the next tick", async () => {
  const w = world();
  w.answer.lockWaitMs = 0;
  writeFileSync(join(w.paths.state, LOCK_FILE), "1\n");
  w.store.pending = [w.phone()];
  await w.tick();
  expect(w.store.settled).toEqual([]);
  expect(noteCalls(w)).toHaveLength(0);
  rmSync(join(w.paths.state, LOCK_FILE));
  await w.tick();
  expect(w.store.settled).toEqual([`phone-p1 delivered ${T0}`]);
  expect(noteCalls(w)).toHaveLength(1);
});
