// The companion's side of the cloud store (build spec §11.2–11.3; ADR 0023): the summary it sends, the calls it makes,
// and the two doors behind them — Convex's HTTP API, and a JSONL file for tests and the e2e (`KINAS_COMPANION_CLOUD`).
//
// `summaryOf` is the only function whose output reaches the cloud. It builds each field by name from the reading and
// clamps every string to the cap the store checks (`cloud/convex/lib/summary.ts`), so a path, a branch, a diff, a log
// line or a key has no field to ride in. The store refuses any other field; a test feeds a reading full of them.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { wordOfInput, type CrewWord } from "@kinas/commands/crew-words";
import type { FactoryEvent } from "@kinas/factory";
import { itemOf, type QuestionOut } from "./answer.ts";
import { fleetOf, type FleetTask } from "./fleet.ts";
import type { PrOut, Reading } from "./run.ts";

/** The caps, equal to the store's `CAPS` (a test holds the two together). */
export const CAPS = { question: 2_000, title: 200, recommendation: 500, project: 100, task: 128, key: 300, label: 32, kind: 40, harness: 40, checks: 40, reply: 2_000, version: 40 } as const;
/** The board the phone gets: what is in flight or queued, at most this many tasks. */
export const BOARD_CAP = 60;
/** The most waiting items one summary carries. */
export const WAITING_CAP = 50;

export interface SummaryTask { task: string; project: string; title: string; word: CrewWord; kind: string; harness: string | null; elapsedS: number | null; pr: number | null; checks: string | null }
export interface SummaryItem { key: string; task: string; project: string; title: string; question: string; recommendation: string | null; since: number }
export interface Summary {
  v: 1;
  asOf: number;
  label: string;
  board: SummaryTask[];
  waiting: SummaryItem[];
  counts: { tasks: number; working: number; waiting: number; blocked: number; inReview: number };
  usage: { planWeekPct: number | null; planSessionPct: number | null };
  host: { cpu: number; memPct: number; diskPct: number };
  heartbeatAt: number;
  lanes: { free: number | null; cap: number | null } | null;
}

/** At most `max` characters (code points), ending in an ellipsis when cut. */
export function clamp(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (used: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0);

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/;
const prNumber = (url: string | null): number | null => {
  const m = url ? PR_URL.exec(url) : null;
  return m ? Number(m[1]) : null;
};

interface PrFacts { state: string | null; draft: boolean; mergeable: string | null; checksTotal: number | null; checksFailed: number | null }

/** `gh pr view`'s fields (run.ts GH_FIELDS), as far as a word and a checks line need them. */
function prFacts(p: PrOut | undefined): PrFacts | null {
  if (!p || p.out.timed_out || p.out.exit !== 0) return null;
  let j: unknown;
  try {
    j = JSON.parse(p.out.stdout);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const rollup = Array.isArray(o.statusCheckRollup) ? (o.statusCheckRollup as Record<string, unknown>[]) : null;
  const failed = rollup?.filter((c) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"].includes(String(c.conclusion ?? c.state ?? ""))).length ?? null;
  return {
    state: typeof o.state === "string" ? o.state : null,
    draft: o.isDraft === true,
    mergeable: typeof o.mergeable === "string" ? o.mergeable : null,
    checksTotal: rollup ? rollup.length : null,
    checksFailed: failed,
  };
}

function wordOf(t: FleetTask, pr: PrFacts | null): CrewWord {
  return wordOfInput({
    gone: false,
    done: t.backlogState === "done",
    state: t.state,
    state_source: t.stateSource,
    backlog_state: t.backlogState,
    pending_decision: t.pendingDecision,
    captain_actionable: t.captainActionable,
    blocked_event: t.blockedEvent,
    merged: false,
    pr: pr ? { state: pr.state, draft: pr.draft, mergeable: pr.mergeable, checks_total: pr.checksTotal, checks_failed: pr.checksFailed } : null,
  });
}

function checksLine(pr: PrFacts | null): string | null {
  if (!pr || pr.checksTotal === null || pr.checksTotal === 0) return null;
  return (pr.checksFailed ?? 0) > 0 ? `${pr.checksFailed} failing` : "passing";
}

/** Seconds in the task's current state, from Firstmate's own `observed_at`; null when it isn't a time. */
function elapsedS(t: FleetTask, at: number): number | null {
  if (t.observedAt === null) return null;
  const ms = Date.parse(t.observedAt);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round((at - ms) / 1000));
}

function planPcts(r: Reading): { planWeekPct: number | null; planSessionPct: number | null } {
  const none = { planWeekPct: null, planSessionPct: null };
  if (!r.plan) return none;
  try {
    const limits = JSON.parse(r.plan.text)?.rate_limits;
    return { planWeekPct: num(limits?.seven_day?.used_percentage), planSessionPct: num(limits?.five_hour?.used_percentage) };
  } catch {
    return none;
  }
}

function lanesOf(r: Reading): Summary["lanes"] {
  if (!r.capacity || r.capacity.exit !== 0) return null;
  try {
    const j = JSON.parse(r.capacity.stdout);
    const cap = j?.cap?.status === "ok" ? num(j?.cap?.target) : null;
    const free = num(j?.verdict?.free_lanes);
    return cap === null && free === null ? null : { free, cap };
  } catch {
    return null;
  }
}

/** What the cloud may know of this reading, and nothing else (ADR 0023). */
export function summaryOf(r: Reading, label: string): Summary {
  const fleet = r.snapshot && !r.snapshot.timed_out && r.snapshot.exit === 0 ? fleetOf(r.snapshot.stdout) : null;
  const tasks = fleet ?? [];
  const prs = new Map(r.prs.map((p) => [p.url, p]));
  const board: SummaryTask[] = [];
  const words = new Map<string, CrewWord>();
  for (const t of tasks) {
    const pr = prFacts(t.prUrl ? prs.get(t.prUrl) : undefined);
    const word = wordOf(t, pr);
    words.set(t.id, word);
    if (word === "done" || word === "gone") continue;
    board.push({
      task: clamp(t.id, CAPS.task),
      project: clamp(t.project ?? "", CAPS.project),
      title: clamp(t.title ?? t.id, CAPS.title),
      word,
      kind: clamp(t.kind, CAPS.kind),
      harness: t.harness === null ? null : clamp(t.harness, CAPS.harness),
      elapsedS: elapsedS(t, r.at),
      pr: prNumber(t.prUrl),
      checks: (() => { const c = checksLine(pr); return c === null ? null : clamp(c, CAPS.checks); })(),
    });
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waiting: SummaryItem[] = [];
  for (const q of (r.questions ?? []) as QuestionOut[]) {
    const t = byId.get(q.task);
    if (!t) continue;
    const decision = t.openDecisions.find((d) => d.key === q.key);
    const question = q.hold ? (t.holdReason ?? t.title ?? t.id) : (decision?.summary || t.title || t.id);
    waiting.push({
      key: clamp(itemOf(q.task, q.key, q.opened_at), CAPS.key),
      task: clamp(q.task, CAPS.task),
      project: clamp(t.project ?? "", CAPS.project),
      title: clamp(t.title ?? t.id, CAPS.title),
      question: clamp(question, CAPS.question),
      recommendation: null,
      since: q.opened_at,
    });
  }
  const host = r.host;
  const count = (f: (w: CrewWord) => boolean) => [...words.values()].filter(f).length;
  return {
    v: 1,
    asOf: r.at,
    label: clamp(label, CAPS.label),
    board: board.slice(0, BOARD_CAP),
    waiting: waiting.slice(0, WAITING_CAP),
    counts: {
      tasks: count((w) => w !== "done" && w !== "gone"),
      working: count((w) => w === "working"),
      waiting: waiting.length,
      blocked: count((w) => w === "blocked" || w === "CI red" || w === "failed"),
      inReview: count((w) => w === "in review"),
    },
    usage: planPcts(r),
    host: host ? { cpu: Math.round(host.cpu_pct ?? 0), memPct: pct(host.mem_used_gb, host.mem_total_gb), diskPct: pct(host.disk_used_gb, host.disk_total_gb) } : { cpu: 0, memPct: 0, diskPct: 0 },
    heartbeatAt: r.companion.heartbeat_at,
    lanes: lanesOf(r),
  };
}

/** The summary's fingerprint without the two times that change every reading, so a quiet factory sends nothing. */
export function fingerprint(s: Summary): string {
  const { asOf: _a, heartbeatAt: _h, ...rest } = s;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

// ---- the calls ----

export interface PendingAnswer {
  requestId: string;
  key: string;
  task: string;
  decision: string;
  kind: "approve" | "deny" | "answer";
  text: string;
  submittedAt: number;
}

export type SettleOutcome = "delivered" | "already" | "not_open" | "expired" | "read";

export interface Cloud {
  replaceReading(s: Summary): Promise<void>;
  heartbeat(at: number, version: string, label: string): Promise<void>;
  takeAnswers(): Promise<PendingAnswer[]>;
  settleAnswer(requestId: string, outcome: SettleOutcome, at: number, reply?: string): Promise<void>;
  startPairing(codeHash: string, expiresAt: number): Promise<void>;
  phones(): Promise<{ id: string; name: string; pairedAt: number; lastSeenAt: number; push: boolean }[]>;
  unpair(id: string): Promise<void>;
  /** Slice 9.2: push a test to every phone that has allowed notifications. */
  testNotification(): Promise<void>;
  /** Slice 11.2: the factory's new events; the store keeps each (task, event, time) once, so telling it twice is harmless. */
  appendFactory(events: FactoryEvent[]): Promise<void>;
}

/** Why a call failed, in words that carry no URL, secret or payload: the log line is `companion: cloud failed (<this>)`. */
export class CloudError extends Error {
  constructor(readonly status: string) {
    super(status);
  }
}

const CALL_LIMIT_MS = 10_000;

/** Convex's HTTP API: `POST <url>/api/query|mutation`, `{path, args, format:"json"}`. The secret travels in `args`, over TLS. */
export function convexCloud(url: string, secret: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Cloud {
  const base = url.replace(/\/+$/, "");
  async function call(kind: "query" | "mutation", path: string, args: Record<string, unknown>): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/api/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, args: { secret, ...args }, format: "json" }),
        signal: AbortSignal.timeout(CALL_LIMIT_MS),
      });
    } catch (e) {
      throw new CloudError((e as Error).name === "TimeoutError" ? "timeout" : "unreachable");
    }
    if (!res.ok && res.status !== 400 && res.status !== 500) throw new CloudError(`http ${res.status}`);
    let body: { status?: string; value?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new CloudError(`http ${res.status}`);
    }
    if (body.status !== "success") throw new CloudError("refused");
    return body.value;
  }
  return {
    replaceReading: async (summary) => void (await call("mutation", "companion:replaceReading", { summary })),
    heartbeat: async (at, version, label) => void (await call("mutation", "companion:heartbeat", { at, version, label })),
    takeAnswers: async () => ((await call("query", "companion:takeAnswers", {})) as PendingAnswer[]) ?? [],
    settleAnswer: async (requestId, outcome, at, reply) => void (await call("mutation", "companion:settleAnswer", { requestId, outcome, at, ...(reply === undefined ? {} : { reply }) })),
    startPairing: async (codeHash, expiresAt) => void (await call("mutation", "companion:startPairing", { codeHash, expiresAt })),
    phones: async () => ((await call("query", "companion:phones", {})) as Awaited<ReturnType<Cloud["phones"]>>) ?? [],
    unpair: async (id) => void (await call("mutation", "companion:unpair", { id })),
    testNotification: async () => void (await call("mutation", "companion:testNotification", {})),
    appendFactory: async (events) => void (await call("mutation", "companion:appendFactory", { events })),
  };
}

/**
 * `KINAS_COMPANION_CLOUD=file:<path>`: every write is one JSON line appended to the file, and the answers to take are the
 * ones planted in `<path>.answers` (a JSON array, read each time). The e2e and the tests read the file back.
 */
export function fileCloud(path: string): Cloud {
  const log = (op: string, args: Record<string, unknown>) => appendFileSync(path, `${JSON.stringify({ op, ...args })}\n`);
  return {
    replaceReading: async (summary) => log("replaceReading", { summary }),
    heartbeat: async (at, version, label) => log("heartbeat", { at, version, label }),
    takeAnswers: async () => {
      const file = `${path}.answers`;
      if (!existsSync(file)) return [];
      try {
        return JSON.parse(readFileSync(file, "utf8")) as PendingAnswer[];
      } catch {
        return [];
      }
    },
    settleAnswer: async (requestId, outcome, at, reply) => log("settleAnswer", { requestId, outcome, at, ...(reply === undefined ? {} : { reply }) }),
    startPairing: async (codeHash, expiresAt) => log("startPairing", { codeHash, expiresAt }),
    phones: async () => [],
    unpair: async (id) => log("unpair", { id }),
    testNotification: async () => log("testNotification", {}),
    appendFactory: async (events) => log("appendFactory", { events }),
  };
}

// ---- companion.env ----

export interface CloudEnv { url: string; secret: string; label: string; phoneUrl: string | null }

/** What the phone calls the machine when `companion.env` names none. */
export const DEFAULT_LABEL = "Linux machine";

/**
 * `~/.config/kinas/companion.env` (docs/external/vps.md): `CONVEX_URL` and `KINAS_COMPANION_SECRET`, one per line. The
 * file must be the user's own and private (mode 0600); `KINAS_COMPANION_LABEL` (a-z, 0-9, `-`, up to 32) names the machine
 * on the phone, and `KINAS_PHONE_URL` the phone page's https address, for the pairing link. A secret in a file others can read is refused, and nothing else
 * is said about it. Never returns the secret in an error.
 */
export function readCompanionEnv(path: string, uid: number): CloudEnv | { error: string } {
  let st;
  try {
    st = statSync(path);
  } catch {
    return { error: "no companion.env" };
  }
  if (!st.isFile()) return { error: "companion.env is not a file" };
  if ((st.mode & 0o077) !== 0) return { error: "companion.env must be mode 0600" };
  if (uid >= 0 && st.uid !== uid) return { error: "companion.env is not yours" };
  const values = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) values.set(m[1]!, m[2]!.replace(/^(["'])(.*)\1$/, "$2"));
  }
  const url = values.get("CONVEX_URL") ?? "";
  const secret = values.get("KINAS_COMPANION_SECRET") ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+(\.convex\.cloud|\.convex\.site)\/?$/.test(url)) return { error: "CONVEX_URL is not a Convex deployment's https address" };
  if (secret.length < 32) return { error: "KINAS_COMPANION_SECRET is missing or too short" };
  const label = values.get("KINAS_COMPANION_LABEL") ?? DEFAULT_LABEL;
  if (label !== DEFAULT_LABEL && !/^[a-z0-9-]{1,32}$/.test(label)) return { error: "KINAS_COMPANION_LABEL is not a label" };
  const phoneUrl = values.get("KINAS_PHONE_URL") ?? null;
  if (phoneUrl !== null && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(phoneUrl)) return { error: "KINAS_PHONE_URL is not an https address" };
  return { url, secret, label, phoneUrl };
}

// ---- tending the cloud from the run loop ----

/** The companion beats this often (spec §11.3 B), and sends the summary again at least this often while nothing changes. */
export const HEARTBEAT_MS = 30_000;
export const RESEND_MS = 5 * 60_000;

export interface TendState { lastHash: string | null; lastSentAt: number; lastBeatAt: number }
export const freshTend = (): TendState => ({ lastHash: null, lastSentAt: 0, lastBeatAt: 0 });

/**
 * After each reading: a heartbeat when one is due, and the summary when it changed (or is five minutes old, so the phone's
 * "last reading" never lies). A cloud that fails is logged by its status alone and never stops the loop: the reading on
 * disk still serves the Mac. The next reading tries again, because the state moves only on a success.
 */
export async function tendCloud(cloud: Cloud, r: Reading, label: string, version: string, st: TendState, now: number, log: (line: string) => void): Promise<void> {
  try {
    if (now - st.lastBeatAt >= HEARTBEAT_MS) {
      await cloud.heartbeat(now, version, label);
      st.lastBeatAt = now;
    }
    const s = summaryOf(r, label);
    const h = fingerprint(s);
    if (h !== st.lastHash || now - st.lastSentAt >= RESEND_MS) {
      await cloud.replaceReading(s);
      st.lastHash = h;
      st.lastSentAt = now;
    }
  } catch (e) {
    log(`companion: cloud failed (${e instanceof CloudError ? e.status : "error"})`);
  }
}
