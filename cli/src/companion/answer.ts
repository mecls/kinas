// The captain's answer, delivered as a note in Firstmate's inbox (build spec §12 slice 6; ADRs 0022, 0025, 0033).
//
// The note is written only while its question is open in a fresh reading (ADR 0033): a worker's question while its key
// is still among the task's open decisions in a snapshot taken now; a captain hold while the hold check exits 0. The
// hold check's other exits are mapped: 1 and 3 (the task is absent) are not open, 2 can't tell, so nothing is written
// and the captain is told. A note Firstmate saved is delivered, also when it couldn't wake the first mate (exit 3): the
// first mate reads it at its next turn. Nothing saved (exit 1), or the runner's sandbox gate (ADR 0027), keeps no row.
//
// The words go on the note's stdin only. They are never logged and never kept here: `answers.jsonl`, in the companion's
// own folder, records what happened to each answer by its request id and its item, with a hash of the words so a
// request id can't be reused for other words. `receipts` repeats each note's words in `body`; `receiptsOf` never copies
// it, so they never leave the machine through Kinas.
//
// The item is `<task>@<key>@<opened_at>` (§12 slice 6, point 7). `opened_at` is the time of the last reading that did
// not list the question: the run loop carries it from reading to reading while the question stays open, and this verb
// works it out the same way from the latest reading, so both name one opening alike. A question asked again under the
// same key, once a reading has seen it closed, is a new item and can be answered again.

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeSync, fstatSync } from "node:fs";
import { join } from "node:path";
import { CALL, LIMITS, type Firstmate, type ScriptOut } from "./firstmate.ts";
import type { Paths } from "./paths.ts";
import { validTaskId } from "./worker.ts";

export type From = "mac" | "phone";
/** What became of an answer that keeps a row: the Mac's `crew_answers.outcome` (migration 0008). */
export type Outcome = "delivered" | "already" | "not_open";

export interface AnswerRequest {
  task: string;
  key: string;
  /** The whole line the first mate reads (the Mac's `answer::line`): `On <task> (<key>): <answer>`. */
  words: string;
  requestId: string;
  from: From;
}

/** Why nothing was written and no row is kept: the toast says `why`. */
export type Refusal = "cannot-tell" | "gate" | "note-failed" | "note-unknown" | "request-reused" | "busy";

export type AnswerReply =
  | { outcome: "delivered"; item: string; at: number; woken: boolean; replay: boolean }
  | { outcome: "already"; item: string; at: number; answered_at: number; answered_from: From }
  | { outcome: "not_open"; item: string; at: number }
  | { refused: Refusal; why: string };

export interface AnswerDeps {
  paths: Paths;
  fm: Firstmate;
  clock: () => number;
  log: (line: string) => void;
  /** Waiting for another answer's lock; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for another answer's lock: LOCK_WAIT_MS unless a test says. */
  lockWaitMs?: number;
}

/** The most the note's words may be, in UTF-8 bytes (build spec §6.4). */
export const MAX_WORDS_BYTES = 8_192;
/** A first mate's reply, as far as Kinas keeps one. */
export const MAX_REPLY_CHARS = 2_000;
/** Receipts are read for a delivered note until it is read and replied to, or this long after it was delivered. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Firstmate's request ids are `[A-Za-z0-9._:-]`, at most 128, never starting with `.`; Kinas's own start `kinas-`. */
export const REQUEST_PREFIX = "kinas-";

const ANSWERS_FILE = "answers.jsonl";
export const LOCK_FILE = "answers.lock";
/** Longer than one answer can take (snapshot 20 s, hold 5 s, note 10 s): an older lock was left by a killed process. */
const LOCK_STALE_MS = 60_000;
/** With one answer's own limits (35 s), the worst case stays under the 60 s the Mac's door gives an answer (slice 6.2). */
const LOCK_WAIT_MS = 20_000;
/** The file is a few hundred bytes an answer; past this only its end is read. */
const ANSWERS_READ_CAP = 16 * 1024 * 1024;

export const WORDS = {
  cannotTell: "Firstmate couldn't tell whether the question is still open; nothing was sent",
  noReading: "Kinas hasn't read Firstmate on the machine yet; nothing was sent",
  noteUnknown: "Firstmate didn't answer in time. The answer may be saved: send it again, and Firstmate keeps only one",
  reused: "This request id was already used for another answer; nothing was sent",
  busy: "Another answer is being sent; send this one again in a moment. Nothing was sent",
  noGate: "no worker check: Kinas writes no note without one",
} as const;

/** A decision key as Firstmate's fold accepts one (`_fm_decision_slug_ok`), at most 128 characters. */
export const decisionKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(v);
/** Kinas's part of a note's request id: `kinas-<this>` stays within Firstmate's 128. */
export const requestId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v);
/** The note's words: some text, no NUL, at most MAX_WORDS_BYTES. */
export const answerWords = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && !v.includes("\u0000") && Buffer.byteLength(v, "utf8") <= MAX_WORDS_BYTES;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const ran = (o: ScriptOut) => !o.timed_out && o.exit === 0 && o.refused === undefined;

// ---- the open questions, from a snapshot ----

export interface QuestionOut {
  task: string;
  key: string;
  /** A captain hold, keyed by its task (the Mac's `mirror::decisions`); otherwise a worker's question. */
  hold: boolean;
  /** The last reading that did not list it: the opening's lower bound, on this machine's clock. */
  opened_at: number;
}

interface OpenSet {
  /** Each task's open decision keys (`hints.open_decisions[].key`). */
  keys: Map<string, Set<string>>;
  /** Each task whose backlog record is captain-actionable. */
  holds: Set<string>;
}

const field = (v: unknown, k: string): unknown => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined);
const list = (v: unknown, ...path: string[]): unknown[] => {
  let cur = v;
  for (const k of path) cur = field(cur, k);
  return Array.isArray(cur) ? cur : [];
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The snapshot's open decisions and holds, merged by task as `snapshot::parse_fleet` merges a record and a row. */
export function openSetOf(snapshot: string): OpenSet | null {
  let root: unknown;
  try {
    root = JSON.parse(snapshot);
  } catch {
    return null;
  }
  // Another schema can't say what is open: the open check then can't tell, never "closed".
  if (field(root, "schema") !== "fm-fleet-snapshot.v1") return null;
  const actionable = new Map<string, boolean>();
  for (const r of list(root, "backlog", "records")) {
    const id = str(field(r, "id"));
    if (field(r, "structured") !== true || id === null || actionable.has(id)) continue;
    actionable.set(id, field(r, "captain_actionable") === true);
  }
  const keys = new Map<string, Set<string>>();
  for (const row of list(root, "tasks")) {
    const id = str(field(row, "id"));
    if (id === null) continue;
    const backlog = field(row, "backlog");
    if (!actionable.has(id) && backlog && typeof backlog === "object") actionable.set(id, field(backlog, "captain_actionable") === true);
    const set = keys.get(id) ?? new Set<string>();
    for (const d of list(row, "hints", "open_decisions")) {
      const key = str(field(d, "key"));
      if (key !== null && str(field(d, "verb")) !== null) set.add(key);
    }
    keys.set(id, set);
  }
  const holds = new Set([...actionable].filter(([, yes]) => yes).map(([id]) => id));
  return { keys, holds };
}

/**
 * The open questions now, each with its opening carried from the last reading (`prev`): one it listed keeps its
 * `opened_at`; a new one gets the last reading's time, or `at` with no last reading. Sorted by task, then key.
 */
export function questionsOf(snapshot: string, prev: { at: number; questions?: QuestionOut[] } | null, at: number): QuestionOut[] | null {
  const set = openSetOf(snapshot);
  if (set === null) return null;
  const before = new Map((prev?.questions ?? []).map((q) => [`${q.task}\n${q.key}\n${q.hold}`, q.opened_at]));
  const out: QuestionOut[] = [];
  const add = (task: string, key: string, hold: boolean) => {
    if (!validTaskId(task) || !decisionKey(key)) return;
    out.push({ task, key, hold, opened_at: before.get(`${task}\n${key}\n${hold}`) ?? prev?.at ?? at });
  };
  for (const [task, keys] of set.keys) for (const key of keys) add(task, key, false);
  for (const task of set.holds) if (!set.keys.get(task)?.has(task)) add(task, task, true);
  return out.sort((a, b) => a.task.localeCompare(b.task) || a.key.localeCompare(b.key));
}

/** `<task>@<key>@<opened_at>`. */
export const itemOf = (task: string, key: string, openedAt: number) => `${task}@${key}@${openedAt}`;

/** The item an answer for `task`/`key` names now, from the latest reading on disk; null with no reading. */
export function itemNow(paths: Paths, task: string, key: string): string | null {
  let r: { v?: unknown; at?: unknown; questions?: unknown };
  try {
    r = JSON.parse(readFileSync(paths.reading, "utf8"));
  } catch {
    return null;
  }
  if (r.v !== 1 || typeof r.at !== "number") return null;
  const qs = Array.isArray(r.questions) ? (r.questions as QuestionOut[]) : [];
  const q = qs.find((x) => x && x.task === task && x.key === key && typeof x.opened_at === "number");
  return itemOf(task, key, q ? q.opened_at : r.at);
}

/** Whether the question is open now (ADR 0033): a fresh snapshot, then, for a hold, Firstmate's own check. */
export async function openNow(fm: Firstmate, task: string, key: string): Promise<{ open: boolean } | { cannot: string }> {
  const snap = await fm.run(CALL.snapshot, LIMITS.snapshot);
  const set = ran(snap) ? openSetOf(snap.stdout) : null;
  if (set === null) return { cannot: WORDS.cannotTell };
  if (set.keys.get(task)?.has(key)) return { open: true };
  // Only a task's own key can name a hold, as on the Mac; any other key gone from the snapshot is closed.
  if (key !== task) return { open: false };
  const o = await fm.run(CALL.holdOpen(task), LIMITS.hold);
  if (o.timed_out) return { cannot: WORDS.cannotTell };
  if (o.exit === 0) return { open: true };
  if (o.exit === 1 || o.exit === 3) return { open: false };
  return { cannot: WORDS.cannotTell };
}

// ---- answers.jsonl: what happened to each answer, never its words ----

type Line =
  | { v: 1; t: "sending"; request_id: string; item: string; task: string; key: string; from: From; at: number; words_sha256: string }
  | { v: 1; t: "outcome"; request_id: string; item: string; task: string; key: string; from: From; at: number; outcome: Outcome; woken?: boolean; replay?: boolean; answered_at?: number; answered_from?: From; words_sha256?: string }
  | { v: 1; t: "unsent"; request_id: string; at: number }
  | { v: 1; t: "read"; request_id: string; at: number }
  | { v: 1; t: "reply"; request_id: string; at: number; reply: string };

/** One answer as the lines fold it. `sending` is one whose note may or may not be saved. */
export interface AnswerRow {
  request_id: string;
  item: string;
  task: string;
  key: string;
  from: From;
  at: number;
  state: Outcome | "sending";
  woken: boolean | null;
  replay: boolean;
  answered_at: number | null;
  answered_from: From | null;
  words_sha256: string | null;
  /** The companion's clock when it first saw the note acknowledged in receipts (Firstmate records no time). */
  read_at: number | null;
  reply: string | null;
  reply_at: number | null;
}

export const answersFile = (paths: Paths) => join(paths.state, ANSWERS_FILE);

/** The file's text, or its last ANSWERS_READ_CAP bytes from a line's start; "" when there is none. */
export function readAnswers(paths: Paths): string {
  let fd: number;
  try {
    fd = openSync(answersFile(paths), "r");
  } catch {
    return "";
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return "";
    const from = Math.max(0, st.size - ANSWERS_READ_CAP);
    const buf = Buffer.alloc(st.size - from);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (n === 0) break;
      got += n;
    }
    const text = buf.subarray(0, got).toString("utf8");
    return from === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    closeSync(fd);
  }
}

/** Folds the lines into one row per request id; a line that isn't one of Kinas's own is skipped. */
export function answersOf(text: string): Map<string, AnswerRow> {
  const rows = new Map<string, AnswerRow>();
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let l: Line;
    try {
      l = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (!l || l.v !== 1 || typeof l.request_id !== "string" || typeof l.at !== "number") continue;
    const row = rows.get(l.request_id);
    switch (l.t) {
      case "sending":
      case "outcome": {
        const base: AnswerRow = row ?? {
          request_id: l.request_id,
          item: l.item,
          task: l.task,
          key: l.key,
          from: l.from,
          at: l.at,
          state: "sending",
          woken: null,
          replay: false,
          answered_at: null,
          answered_from: null,
          words_sha256: null,
          read_at: null,
          reply: null,
          reply_at: null,
        };
        base.item = l.item;
        base.at = l.at;
        base.words_sha256 = l.words_sha256 ?? base.words_sha256;
        if (l.t === "outcome") {
          base.state = l.outcome;
          base.woken = l.woken ?? null;
          base.replay = l.replay ?? false;
          base.answered_at = l.answered_at ?? null;
          base.answered_from = l.answered_from ?? null;
        } else base.state = "sending";
        rows.set(l.request_id, base);
        break;
      }
      case "unsent":
        // Nothing was saved: the request id is free again, and a resend checks the question afresh.
        if (row && row.state === "sending") rows.delete(l.request_id);
        break;
      case "read":
        if (row && row.read_at === null) row.read_at = l.at;
        break;
      case "reply":
        if (row && row.reply === null && typeof l.reply === "string") {
          row.reply = l.reply;
          row.reply_at = l.at;
        }
        break;
    }
  }
  return rows;
}

function append(paths: Paths, line: Line): void {
  mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  const fd = openSync(answersFile(paths), "a", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
  } finally {
    closeSync(fd);
  }
}

/** The answers the bundle carries (§12 slice 6, point 7): those that keep a row, newest last, at most `cap`. */
export function answersForBundle(paths: Paths, cap = 200): Omit<AnswerRow, "words_sha256">[] {
  return [...answersOf(readAnswers(paths)).values()]
    .filter((r) => r.state !== "sending")
    .sort((a, b) => a.at - b.at || a.request_id.localeCompare(b.request_id))
    .slice(-cap)
    .map(({ words_sha256: _, ...r }) => r);
}

// ---- one answer at a time ----

/** The lock file, made exclusively; a lock older than LOCK_STALE_MS is a killed process's and is taken over. */
async function takeLock(paths: Paths, sleep: (ms: number) => Promise<void>, waitMs: number): Promise<(() => void) | null> {
  mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  const file = join(paths.state, LOCK_FILE);
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => {
        try {
          unlinkSync(file);
        } catch {
          // gone already
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }
    try {
      if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(file);
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > until) return null;
    await sleep(100);
  }
}

/** Delivers one answer, or says why not. Throws only when `answers.jsonl` can't be written before the note. */
export async function deliver(deps: AnswerDeps, req: AnswerRequest): Promise<AnswerReply> {
  const release = await takeLock(deps.paths, deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), deps.lockWaitMs ?? LOCK_WAIT_MS);
  if (release === null) return { refused: "busy", why: WORDS.busy };
  try {
    return await deliverLocked(deps, req);
  } finally {
    release();
  }
}

async function deliverLocked(deps: AnswerDeps, req: AnswerRequest): Promise<AnswerReply> {
  const { paths } = deps;
  const rows = answersOf(readAnswers(paths));
  const words = sha256(req.words);
  const same = rows.get(req.requestId);
  if (same) {
    if (same.task !== req.task || same.key !== req.key || (same.words_sha256 !== null && same.words_sha256 !== words)) return { refused: "request-reused", why: WORDS.reused };
    switch (same.state) {
      // Sent again after a lost reply (point 4): what happened the first time, and nothing runs.
      case "delivered":
        return { outcome: "delivered", item: same.item, at: same.at, woken: same.woken ?? true, replay: true };
      case "already":
        return { outcome: "already", item: same.item, at: same.at, answered_at: same.answered_at ?? same.at, answered_from: same.answered_from ?? same.from };
      case "not_open":
        return { outcome: "not_open", item: same.item, at: same.at };
      // The first try may have saved the note: it passed the open check then, and the same request id saves one note.
      case "sending":
        return note(deps, req, same.item, words);
    }
  }

  const item = itemNow(paths, req.task, req.key);
  if (item === null) return { refused: "cannot-tell", why: WORDS.noReading };
  const now = deps.clock();
  const base = { v: 1 as const, request_id: req.requestId, item, task: req.task, key: req.key, from: req.from, at: now, words_sha256: words };

  const first = [...rows.values()].find((r) => r.item === item && r.state === "delivered");
  if (first) {
    append(paths, { ...base, t: "outcome", outcome: "already", answered_at: first.at, answered_from: first.from });
    deps.log("companion: answer already");
    return { outcome: "already", item, at: now, answered_at: first.at, answered_from: first.from };
  }

  const open = await openNow(deps.fm, req.task, req.key);
  if ("cannot" in open) {
    deps.log("companion: answer refused (can't tell)");
    return { refused: "cannot-tell", why: open.cannot };
  }
  if (!open.open) {
    append(paths, { ...base, t: "outcome", outcome: "not_open" });
    deps.log("companion: answer not open");
    return { outcome: "not_open", item, at: now };
  }

  append(paths, { ...base, t: "sending" });
  return note(deps, req, item, words);
}

/** The note, under Kinas's request id; its outcome recorded. A `sending` line is already there. */
async function note(deps: AnswerDeps, req: AnswerRequest, item: string, words: string): Promise<AnswerReply> {
  const { paths } = deps;
  const o = await deps.fm.run(CALL.note(`${REQUEST_PREFIX}${req.requestId}`, req.words), LIMITS.inbox);
  const now = deps.clock();
  if (o.refused !== undefined) {
    append(paths, { v: 1, t: "unsent", request_id: req.requestId, at: now });
    deps.log("companion: answer refused (the worker check)");
    return { refused: "gate", why: o.refused || WORDS.noGate };
  }
  if (o.timed_out) {
    deps.log("companion: answer unknown (the note timed out)");
    return { refused: "note-unknown", why: WORDS.noteUnknown };
  }
  if (o.exit !== 0 && o.exit !== 3) {
    append(paths, { v: 1, t: "unsent", request_id: req.requestId, at: now });
    deps.log(`companion: answer not saved (exit ${o.exit})`);
    const said = (o.stderr_first ?? "").trim().slice(0, 200);
    return { refused: "note-failed", why: said ? `Firstmate saved nothing: ${said}` : "Firstmate saved nothing" };
  }
  let replay = false;
  try {
    replay = (JSON.parse(o.stdout) as { outcome?: unknown }).outcome === "replay";
  } catch {
    replay = false;
  }
  const woken = o.exit === 0;
  try {
    append(paths, { v: 1, t: "outcome", request_id: req.requestId, item, task: req.task, key: req.key, from: req.from, at: now, outcome: "delivered", woken, replay, words_sha256: words });
  } catch {
    // Delivered all the same: a resend under this request id replays the saved note.
    deps.log("companion: answer delivered, not recorded");
  }
  deps.log(`companion: answer delivered${woken ? "" : " (the first mate not woken)"}`);
  return { outcome: "delivered", item, at: now, woken, replay };
}

// ---- receipts: read and replied ----

export interface Receipt {
  acknowledged: boolean;
  reply: string | null;
  /** Firstmate's own time for the reply, in ms; null when it isn't readable. */
  reply_at: number | null;
}

/**
 * `fm-inbox-receipts.v1`'s notes under Kinas's request ids, keyed by Kinas's part of the id. A note's `body` (the
 * captain's words) and the home's paths are never read into it.
 */
export function receiptsOf(json: string): Map<string, Receipt> {
  const out = new Map<string, Receipt>();
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return out;
  }
  if (field(root, "schema") !== "fm-inbox-receipts.v1") return out;
  for (const [group, acknowledged] of [["pending", false], ["handled", true]] as const) {
    for (const n of list(root, group)) {
      const id = field(n, "request_id");
      if (typeof id !== "string" || !id.startsWith(REQUEST_PREFIX)) continue;
      const own = id.slice(REQUEST_PREFIX.length);
      if (!requestId(own)) continue;
      const r = field(n, "reply");
      const body = field(r, "body");
      const at = Date.parse(String(field(r, "at") ?? ""));
      const reply = typeof body === "string" && body.trim() !== "" ? body.trim().slice(0, MAX_REPLY_CHARS) : null;
      const prior = out.get(own);
      // A note listed in both is the handled one (receipts lists pending first).
      if (prior && prior.acknowledged && !acknowledged) continue;
      out.set(own, { acknowledged: acknowledged || field(n, "acknowledged") === true, reply, reply_at: reply !== null && Number.isFinite(at) ? at : null });
    }
  }
  return out;
}

/**
 * One look at the receipts while a delivered note is unread, or unreplied within REPLY_WINDOW_MS: the first time a
 * note is seen acknowledged is its `read_at`, and a reply is kept once.
 */
export async function tendReceipts(deps: Omit<AnswerDeps, "sleep">): Promise<void> {
  const rows = answersOf(readAnswers(deps.paths));
  const now = deps.clock();
  const waiting = [...rows.values()].filter((r) => r.state === "delivered" && (r.read_at === null || (r.reply === null && now - r.at < REPLY_WINDOW_MS)));
  if (waiting.length === 0) return;
  const o = await deps.fm.run(CALL.receipts, LIMITS.inbox);
  if (!ran(o)) {
    deps.log("companion: receipts unread");
    return;
  }
  const seen = receiptsOf(o.stdout);
  let read = 0;
  for (const r of waiting) {
    const s = seen.get(r.request_id);
    if (!s) continue;
    if (s.acknowledged && r.read_at === null) {
      append(deps.paths, { v: 1, t: "read", request_id: r.request_id, at: now });
      read++;
    }
    if (s.reply !== null && r.reply === null) append(deps.paths, { v: 1, t: "reply", request_id: r.request_id, at: s.reply_at ?? now, reply: s.reply });
  }
  if (read > 0) deps.log(`companion: ${read} answers read`);
}
