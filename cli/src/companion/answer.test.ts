import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answersFile,
  answersForBundle,
  answersOf,
  deliver,
  itemOf,
  LOCK_FILE,
  MAX_REPLY_CHARS,
  openSetOf,
  questionsOf,
  readAnswers,
  receiptsOf,
  tendReceipts,
  WORDS,
  type AnswerDeps,
  type AnswerReply,
  type AnswerRequest,
  type QuestionOut,
} from "./answer.ts";
import type { FmCall, ScriptOut } from "./firstmate.ts";
import { companionPaths } from "./paths.ts";

// Slice 6.1 (build spec §12, slice 6; ADR 0033): the companion's answer. A fake Firstmate runner answers each call and
// logs it, so each test proves which scripts ran, with what, and that the words went on the note's stdin only.

const T0 = 1_795_700_000_000;
const TASK = "t1-9c2e";
const KEY = "api-shape-9c2e";
const WORDS_SECRET = "On t1-9c2e (api-shape-9c2e): REST, secret-words-7f3a";

const out = (exit: number | null, stdout = "", extra: Partial<ScriptOut> = {}): ScriptOut => ({ exit, timed_out: exit === null, stdout, stderr_first: null, ...extra });

function snapshot(o: { decisions?: Record<string, string[]>; holds?: string[]; schema?: string } = {}): string {
  const ids = [...new Set([...Object.keys(o.decisions ?? {}), ...(o.holds ?? [])])];
  return JSON.stringify({
    schema: o.schema ?? "fm-fleet-snapshot.v1",
    backlog: { records: ids.map((id) => ({ structured: true, id, state: "in_flight", captain_actionable: (o.holds ?? []).includes(id) })) },
    tasks: Object.entries(o.decisions ?? {}).map(([id, keys]) => ({ id, hints: { open_decisions: keys.map((key) => ({ key, verb: "needs-decision", summary: "which shape?" })) } })),
  });
}

const noteJson = (outcome: "created" | "replay") => JSON.stringify({ schema: "fm-inbox-note.v1", outcome, id: "1795700000-abc", request_id: "kinas-r1", saved: true, announced: true, acknowledged: false, path: "/home/x/inbox/1.note" });

interface Call {
  script: string;
  args: string[];
  stdin?: string;
}

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-answer-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  const calls: Call[] = [];
  const lines: string[] = [];
  const now = { t: T0 };
  const fm = {
    snapshot: out(0, snapshot({ decisions: { [TASK]: [KEY] } })),
    hold: out(1),
    note: out(0, noteJson("created")) as ScriptOut,
    receipts: out(0, JSON.stringify({ schema: "fm-inbox-receipts.v1", pending: [], handled: [] })),
  };
  const deps: AnswerDeps = {
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
    log: (l) => lines.push(l),
    sleep: async () => {},
  };
  /** The latest reading on disk, as the run loop leaves it. */
  const reading = (at: number, questions: QuestionOut[]) => {
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.reading, JSON.stringify({ v: 1, at, questions }));
  };
  reading(T0 - 15_000, [{ task: TASK, key: KEY, hold: false, opened_at: T0 - 60_000 }]);
  const ask = (o: Partial<AnswerRequest> = {}) => deliver(deps, { task: TASK, key: KEY, words: WORDS_SECRET, requestId: "r1", from: "mac", ...o });
  const file = () => (existsSync(answersFile(paths)) ? readFileSync(answersFile(paths), "utf8") : "");
  return { root, paths, calls, lines, now, fm, deps, reading, ask, file };
}

const scripts = (calls: Call[]) => calls.map((c) => `${c.script} ${c.args[0]}`);

describe("an answer is delivered while its question is open (ADR 0033)", () => {
  test("a worker's key still open: one note under kinas-<id>, the words on stdin only, the item naming the opening", async () => {
    const w = world();
    const reply = await w.ask();
    expect(reply).toEqual({ outcome: "delivered", item: `${TASK}@${KEY}@${T0 - 60_000}`, at: T0, woken: true, replay: false });
    expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json", "fm-inbox.sh note"]);
    const note = w.calls[1]!;
    expect(note.args).toEqual(["note", "--request-id", "kinas-r1", "--json", "-"]);
    expect(note.stdin).toBe(WORDS_SECRET);
    expect(w.calls.filter((c) => c.args.join(" ").includes("secret-words"))).toEqual([]);
    // The record keeps what happened, never the words; the log names neither the task nor the words.
    expect(w.file()).not.toContain("secret-words");
    expect(w.file()).not.toContain("REST");
    expect(w.lines.join("\n")).not.toContain("9c2e");
    expect(w.lines.join("\n")).not.toContain("secret-words");
    expect(answersForBundle(w.paths)).toEqual([
      { request_id: "r1", item: `${TASK}@${KEY}@${T0 - 60_000}`, task: TASK, key: KEY, from: "mac", at: T0, state: "delivered", woken: true, replay: false, answered_at: null, answered_from: null, read_at: null, reply: null, reply_at: null },
    ]);
  });

  test("a worker's key gone from the fresh snapshot: not_open, no note, no hold check", async () => {
    const w = world();
    w.fm.snapshot = out(0, snapshot({ decisions: { [TASK]: ["other-9c2e"] } }));
    expect(await w.ask()).toEqual({ outcome: "not_open", item: `${TASK}@${KEY}@${T0 - 60_000}`, at: T0 });
    expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json"]);
    expect(answersForBundle(w.paths).map((r) => r.state)).toEqual(["not_open"]);
  });

  test("a captain hold: open exit 0 delivers; exits 1 and 3 are not open; exit 2 writes nothing and says so", async () => {
    for (const [exit, want] of [[0, "delivered"], [1, "not_open"], [3, "not_open"]] as const) {
      const w = world();
      w.reading(T0 - 15_000, [{ task: TASK, key: TASK, hold: true, opened_at: T0 - 90_000 }]);
      w.fm.snapshot = out(0, snapshot({ holds: [TASK] }));
      w.fm.hold = out(exit);
      const reply = await w.ask({ key: TASK, words: `On ${TASK}: Approved — go ahead.` });
      expect("outcome" in reply && reply.outcome).toBe(want);
      expect(w.calls[1]).toEqual({ script: "fm-captain-hold.sh", args: ["open", TASK, "--distinguish-absent"] });
      expect(scripts(w.calls)).toEqual(want === "delivered" ? ["fm-fleet-snapshot.sh --json", "fm-captain-hold.sh open", "fm-inbox.sh note"] : ["fm-fleet-snapshot.sh --json", "fm-captain-hold.sh open"]);
    }
    for (const hold of [out(2), out(null), out(127)]) {
      const w = world();
      w.fm.snapshot = out(0, snapshot({ holds: [TASK] }));
      w.fm.hold = hold;
      expect(await w.ask({ key: TASK })).toEqual({ refused: "cannot-tell", why: WORDS.cannotTell });
      expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json", "fm-captain-hold.sh open"]);
      expect(w.file()).toBe("");
    }
  });

  test("a task's own key open as a worker's question needs no hold check", async () => {
    const w = world();
    w.fm.snapshot = out(0, snapshot({ decisions: { [TASK]: [TASK] }, holds: [TASK] }));
    expect(await w.ask({ key: TASK })).toMatchObject({ outcome: "delivered" });
    expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json", "fm-inbox.sh note"]);
  });

  test("a snapshot that can't be read can't tell: nothing written, no row", async () => {
    for (const snap of [out(1), out(null), out(0, "not json"), out(0, snapshot({ schema: "fm-fleet-snapshot.v2", decisions: { [TASK]: [KEY] } }))]) {
      const w = world();
      w.fm.snapshot = snap;
      expect(await w.ask()).toEqual({ refused: "cannot-tell", why: WORDS.cannotTell });
      expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json"]);
      expect(w.file()).toBe("");
    }
  });

  test("no reading on the machine yet: nothing runs", async () => {
    const w = world();
    writeFileSync(w.paths.reading, "{}");
    expect(await w.ask()).toEqual({ refused: "cannot-tell", why: WORDS.noReading });
    expect(w.calls).toEqual([]);
  });
});

describe("what Firstmate's note says", () => {
  test("exit 3, saved but the first mate not woken: delivered, read at its next turn", async () => {
    const w = world();
    w.fm.note = out(3, noteJson("created"));
    expect(await w.ask()).toMatchObject({ outcome: "delivered", woken: false, replay: false });
    expect(answersForBundle(w.paths)[0]).toMatchObject({ state: "delivered", woken: false });
  });

  test("exit 1, nothing saved: no row, Firstmate's words shown; sending again checks the question afresh", async () => {
    const w = world();
    w.fm.note = out(1, "", { stderr_first: "fm-inbox: request id kinas-r1 is reserved but unreadable" });
    expect(await w.ask()).toEqual({ refused: "note-failed", why: "Firstmate saved nothing: fm-inbox: request id kinas-r1 is reserved but unreadable" });
    expect(answersForBundle(w.paths)).toEqual([]);
    w.fm.note = out(0, noteJson("replay"));
    expect(await w.ask()).toMatchObject({ outcome: "delivered", replay: true });
    expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json", "fm-inbox.sh note", "fm-fleet-snapshot.sh --json", "fm-inbox.sh note"]);
  });

  test("the sandbox gate refuses: no row, the gate's words", async () => {
    const w = world();
    w.fm.note = out(null, "", { timed_out: false, refused: "kp1 runs outside the sandbox" });
    expect(await w.ask()).toEqual({ refused: "gate", why: "kp1 runs outside the sandbox" });
    expect(answersForBundle(w.paths)).toEqual([]);
    expect(answersOf(readAnswers(w.paths)).size).toBe(0);
  });

  test("a note that timed out is unknown; sent again under the same id, it skips the open check and Firstmate keeps one", async () => {
    const w = world();
    w.fm.note = out(null);
    expect(await w.ask()).toEqual({ refused: "note-unknown", why: WORDS.noteUnknown });
    expect(answersForBundle(w.paths)).toEqual([]);
    // The first mate read it and closed the key meanwhile: the resend is still the same answer.
    w.fm.snapshot = out(0, snapshot({ decisions: { [TASK]: [] } }));
    w.fm.note = out(0, noteJson("replay"));
    expect(await w.ask()).toMatchObject({ outcome: "delivered", replay: true });
    expect(scripts(w.calls)).toEqual(["fm-fleet-snapshot.sh --json", "fm-inbox.sh note", "fm-inbox.sh note"]);
    expect(w.calls[2]!.args).toEqual(["note", "--request-id", "kinas-r1", "--json", "-"]);
  });
});

describe("once, and once per opening", () => {
  test("sent again after a lost reply: what happened the first time, and nothing runs", async () => {
    const w = world();
    const first = await w.ask();
    w.now.t += 5_000;
    expect(await w.ask()).toEqual({ ...(first as Extract<AnswerReply, { outcome: "delivered" }>), replay: true });
    expect(w.calls).toHaveLength(2);
  });

  test("a request id reused for other words, or another item, is refused", async () => {
    const w = world();
    await w.ask();
    expect(await w.ask({ words: "On t1-9c2e (api-shape-9c2e): GraphQL" })).toEqual({ refused: "request-reused", why: WORDS.reused });
    expect(await w.ask({ key: "other-9c2e" })).toEqual({ refused: "request-reused", why: WORDS.reused });
    expect(w.calls).toHaveLength(2);
  });

  test("already: a second answer for the same item makes no call and names the first", async () => {
    const w = world();
    await w.ask();
    w.now.t = T0 + 60_000;
    expect(await w.ask({ requestId: "r2", words: "On t1-9c2e (api-shape-9c2e): Denied." })).toEqual({ outcome: "already", item: `${TASK}@${KEY}@${T0 - 60_000}`, at: T0 + 60_000, answered_at: T0, answered_from: "mac" });
    expect(w.calls).toHaveLength(2);
    expect(answersForBundle(w.paths).map((r) => [r.request_id, r.state])).toEqual([["r1", "delivered"], ["r2", "already"]]);
  });

  test("the same key asked again, after a reading saw it closed, is a new item", async () => {
    const w = world();
    await w.ask();
    // A reading without it (closed), then the worker asks again: the new opening is after that reading.
    w.reading(T0 + 30_000, []);
    w.now.t = T0 + 40_000;
    expect(await w.ask({ requestId: "r3" })).toMatchObject({ outcome: "delivered", item: `${TASK}@${KEY}@${T0 + 30_000}` });
    // The loop's next reading names that opening alike.
    const next = questionsOf(snapshot({ decisions: { [TASK]: [KEY] } }), { at: T0 + 30_000, questions: [] }, T0 + 45_000);
    expect(next).toEqual([{ task: TASK, key: KEY, hold: false, opened_at: T0 + 30_000 }]);
  });

  test("one answer at a time: a held lock is waited for, a killed one's is taken over", async () => {
    const w = world();
    const lock = join(w.paths.state, LOCK_FILE);
    writeFileSync(lock, "999999\n");
    expect(await deliver({ ...w.deps, lockWaitMs: 0 }, { task: TASK, key: KEY, words: WORDS_SECRET, requestId: "r1", from: "mac" })).toEqual({ refused: "busy", why: WORDS.busy });
    expect(w.calls).toEqual([]);
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(lock, old, old);
    expect(await w.ask()).toMatchObject({ outcome: "delivered" });
    expect(existsSync(lock)).toBe(false);
  });
});

describe("the open questions in a reading", () => {
  test("each worker's key and each hold; an opening carried while it stays open; a new one after the last reading", () => {
    const snap = snapshot({ decisions: { [TASK]: [KEY, "new-9c2e"], "t2-9c2e": ["t2-9c2e"], "bad id": ["k"] }, holds: ["t2-9c2e", "t3-9c2e"] });
    const prev = { at: T0, questions: [{ task: TASK, key: KEY, hold: false, opened_at: T0 - 99 }, { task: "t3-9c2e", key: "t3-9c2e", hold: true, opened_at: T0 - 7 }] };
    expect(questionsOf(snap, prev, T0 + 15_000)).toEqual([
      { task: TASK, key: KEY, hold: false, opened_at: T0 - 99 },
      { task: TASK, key: "new-9c2e", hold: false, opened_at: T0 },
      // Its own key open as a worker's question: no hold beside it, as on the Mac.
      { task: "t2-9c2e", key: "t2-9c2e", hold: false, opened_at: T0 },
      { task: "t3-9c2e", key: "t3-9c2e", hold: true, opened_at: T0 - 7 },
    ]);
    expect(questionsOf(snap, null, T0 + 15_000)?.every((q) => q.opened_at === T0 + 15_000 || q.task === "x")).toBe(true);
    expect(questionsOf("not json", prev, T0)).toBeNull();
    expect(openSetOf(snapshot({ schema: "other" }))).toBeNull();
    expect(itemOf("a", "b", 3)).toBe("a@b@3");
  });

  test("a task row with no backlog record takes the row's own record", () => {
    const snap = JSON.stringify({ schema: "fm-fleet-snapshot.v1", backlog: { records: [] }, tasks: [{ id: "t4-9c2e", backlog: { captain_actionable: true }, hints: { open_decisions: [] } }] });
    expect(questionsOf(snap, null, T0)).toEqual([{ task: "t4-9c2e", key: "t4-9c2e", hold: true, opened_at: T0 }]);
  });
});

describe("receipts: read and replied, never the words", () => {
  const receipts = (pending: object[], handled: object[]) => JSON.stringify({ schema: "fm-inbox-receipts.v1", home: "x/firstmate", pending, handled, replies: [], omitted: [] });
  const note = (request_id: string | null, reply: object | null = null) => ({ id: "n", at: "2026-11-26T10:00:00Z", source: "text", request_id, body: "On t1-9c2e: secret-words-7f3a", acknowledged: false, announced: true, reply });

  test("receiptsOf keeps Kinas's own notes, by its part of the id, and never their body", () => {
    const seen = receiptsOf(
      receipts(
        [note("kinas-r1"), note("kinas-r2"), note("someone-else"), note(null)],
        [note("kinas-r2", { id: "n", at: "2026-11-26T10:05:00Z", body: "Relayed it.", cursor: "000000000001" }), note("kinas-r3", { at: "x", body: "y".repeat(5_000) })],
      ),
    );
    expect([...seen.keys()].sort()).toEqual(["r1", "r2", "r3"]);
    expect(seen.get("r1")).toEqual({ acknowledged: false, reply: null, reply_at: null });
    expect(seen.get("r2")).toEqual({ acknowledged: true, reply: "Relayed it.", reply_at: Date.parse("2026-11-26T10:05:00Z") });
    expect(seen.get("r3")!.reply).toHaveLength(MAX_REPLY_CHARS);
    expect(seen.get("r3")!.reply_at).toBeNull();
    expect(JSON.stringify([...seen])).not.toContain("secret-words");
    expect(receiptsOf("not json").size).toBe(0);
    expect(receiptsOf(JSON.stringify({ schema: "other", pending: [note("kinas-r1")] })).size).toBe(0);
  });

  test("read once, at the companion's clock; a reply kept once; nothing asked once both are in", async () => {
    const w = world();
    await tendReceipts(w.deps);
    expect(w.calls).toEqual([]);
    await w.ask();
    w.calls.length = 0;
    w.fm.receipts = out(0, receipts([note("kinas-r1")], []));
    await tendReceipts(w.deps);
    expect(answersForBundle(w.paths)[0]).toMatchObject({ read_at: null, reply: null });
    w.now.t = T0 + 20_000;
    w.fm.receipts = out(0, receipts([], [note("kinas-r1")]));
    await tendReceipts(w.deps);
    w.now.t = T0 + 40_000;
    await tendReceipts(w.deps);
    expect(answersForBundle(w.paths)[0]).toMatchObject({ read_at: T0 + 20_000, reply: null });
    w.fm.receipts = out(0, receipts([], [note("kinas-r1", { at: "2026-11-26T10:05:00Z", body: "Relayed to the worker." })]));
    await tendReceipts(w.deps);
    expect(answersForBundle(w.paths)[0]).toMatchObject({ read_at: T0 + 20_000, reply: "Relayed to the worker.", reply_at: Date.parse("2026-11-26T10:05:00Z") });
    const asked = w.calls.length;
    await tendReceipts(w.deps);
    expect(w.calls).toHaveLength(asked);
    expect(scripts(w.calls).every((s) => s === "fm-inbox.sh receipts")).toBe(true);
    expect(w.file()).not.toContain("secret-words");
  });

  test("a note read but never replied to is asked about for a day, then left", async () => {
    const w = world();
    await w.ask();
    w.fm.receipts = out(0, receipts([], [note("kinas-r1")]));
    await tendReceipts(w.deps);
    const asked = w.calls.length;
    w.now.t = T0 + 23 * 3_600_000;
    await tendReceipts(w.deps);
    expect(w.calls).toHaveLength(asked + 1);
    w.now.t = T0 + 25 * 3_600_000;
    await tendReceipts(w.deps);
    expect(w.calls).toHaveLength(asked + 1);
  });
});
