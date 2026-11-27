// A phone's answers, through the cloud store (build spec §11.3 D; slice 10.2). Every five seconds the companion takes the
// answers the store holds as pending, delivers each as the note the Mac's answer is (the one `deliver`, with its open check,
// its sandbox gate and its request id), and tells the store what became of it. Then, for what it delivered, whether the
// first mate has read it and what it replied. The store never sees the words coming back, and the log never sees them.

import { answerLine } from "@kinas/commands/answer-line";
import { answersForBundle, deliver, type AnswerDeps } from "./answer.ts";
import { CloudError, type Cloud, type PendingAnswer, type SettleOutcome } from "./cloud.ts";

export const PHONE_EVERY_MS = 5_000;
/** An answer older than this is never delivered (§6.5); the store's cron expires it too. */
export const ANSWER_TTL_MS = 60_000;

export interface PhoneDeps {
  cloud: Cloud;
  answer: AnswerDeps;
  clock: () => number;
  log: (line: string) => void;
}

/** What the store was last told of each answer's read and reply, so each is said once while the process lives. */
export interface PhoneState {
  told: Map<string, { read: boolean; reply: boolean }>;
}
export const freshPhone = (): PhoneState => ({ told: new Map() });

const failed = (log: (l: string) => void, e: unknown) => log(`companion: cloud failed (${e instanceof CloudError ? e.status : "error"})`);

/** One answer to its outcome for the store, or null when it stays pending (another answer is being sent: try again). */
async function settleOf(a: PendingAnswer, d: PhoneDeps): Promise<SettleOutcome | null> {
  const now = d.clock();
  if (now - a.submittedAt > ANSWER_TTL_MS) return "expired";
  const words = answerLine(a.task, a.decision, a.kind, a.text);
  if (words === null) return "expired";
  const r = await deliver(d.answer, { task: a.task, key: a.decision, words, requestId: a.requestId, from: "phone" });
  if ("refused" in r) return r.refused === "busy" ? null : "expired";
  return r.outcome;
}

export async function tendPhone(d: PhoneDeps, st: PhoneState): Promise<void> {
  let pending: PendingAnswer[];
  try {
    pending = await d.cloud.takeAnswers();
  } catch (e) {
    failed(d.log, e);
    return;
  }
  for (const a of pending) {
    const outcome = await settleOf(a, d);
    if (outcome === null) continue;
    try {
      await d.cloud.settleAnswer(a.requestId, outcome, d.clock());
    } catch (e) {
      // The note may be saved: the next tick asks again under the same request id, and Firstmate keeps one note.
      failed(d.log, e);
    }
  }
  // What the first mate did with a phone's answers: read it, then replied. The Mac's own rows are not the store's.
  for (const r of answersForBundle(d.answer.paths)) {
    if (r.from !== "phone" || r.state !== "delivered") continue;
    const told = st.told.get(r.request_id) ?? { read: false, reply: false };
    const readNow = r.read_at !== null && !told.read;
    const replyNow = r.reply !== null && !told.reply;
    if (!readNow && !replyNow) continue;
    try {
      await d.cloud.settleAnswer(r.request_id, "read", r.read_at ?? d.clock(), r.reply ?? undefined);
      st.told.set(r.request_id, { read: told.read || r.read_at !== null, reply: told.reply || r.reply !== null });
    } catch (e) {
      failed(d.log, e);
    }
  }
}

/** The loop: a tick now, then every five seconds after the last has finished. Never returns; a tick that throws is logged. */
export async function phoneLoop(d: PhoneDeps, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<never> {
  const st = freshPhone();
  for (;;) {
    const started = d.clock();
    try {
      await tendPhone(d, st);
    } catch (e) {
      d.log(`companion: phone answers failed (${(e as Error).name})`);
    }
    await sleep(Math.max(0, PHONE_EVERY_MS - (d.clock() - started)));
  }
}
