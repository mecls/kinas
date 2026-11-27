// What a paired phone may do (build spec §8, §11.2): pair itself, read the summary, answer, and keep its own push
// subscription. Every function but `pair` starts with the device's token, whose hash names its row. A phone can't pair
// another phone, change a setting or reach the Linux machine.

import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { PAIR_WORDS, newToken, normalizeCode, pairVerdict, sha256Hex } from "./lib/auth.ts";
import { judgeSubmit, type AnswerRow } from "./lib/answers.ts";
import { CAPS } from "./lib/summary.ts";
import { inboxOf } from "./lib/waiting.ts";

/** The device a token belongs to, or a refusal the phone answers with its Pair screen. */
async function deviceOf(ctx: QueryCtx, token: string) {
  const hash = await sha256Hex(token);
  const found = await ctx.db.query("devices").withIndex("by_tokenHash", (q) => q.eq("tokenHash", hash)).unique();
  if (!found) throw new ConvexError("unpaired");
  return found;
}

const clock = () => Date.now();

/**
 * Finish a pairing with the code the Mac showed. A refusal is a value, not a throw: a throw would roll back the count
 * of wrong tries, and the count is what keeps a code from being guessed.
 */
export const pair = mutation({
  args: { code: v.string(), name: v.string() },
  handler: async (ctx: MutationCtx, { code, name }) => {
    const now = clock();
    const rows = await ctx.db.query("pairings").withIndex("by_expiresAt").order("desc").take(1);
    const row = rows[0] ?? null;
    const given = await sha256Hex(normalizeCode(code));
    const verdict = pairVerdict(row, given, now);
    if (verdict === "wrong" && row) {
      await ctx.db.patch(row._id, { tries: row.tries + 1 });
      return { error: PAIR_WORDS.wrong };
    }
    if (verdict !== "ok" || !row) return { error: PAIR_WORDS[verdict === "ok" ? "none" : verdict] };
    const token = newToken();
    const label = name.trim() === "" ? "Phone" : [...name.trim()].slice(0, CAPS.deviceName).join("");
    await ctx.db.patch(row._id, { usedAt: now });
    await ctx.db.insert("devices", { name: label, tokenHash: await sha256Hex(token), pairedAt: now, lastSeenAt: now });
    return { token };
  },
});

/** The latest summary and when the companion last beat, for the phone's stale caption. Null before a first reading. */
export const reading = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await deviceOf(ctx, token);
    const row = await ctx.db.query("reading").first();
    const companion = await ctx.db.query("companion").first();
    return { summary: row?.summary ?? null, heartbeatAt: companion?.heartbeatAt ?? null };
  },
});

/** The items waiting, each with its latest answer. */
export const inbox = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await deviceOf(ctx, token);
    const rows = await ctx.db.query("waiting").collect();
    const answers = await ctx.db.query("answers").collect();
    return inboxOf(rows, answers);
  },
});

/**
 * Submit an answer to an item. A refusal is a value the phone shows: the answer isn't stored, and it didn't reach the
 * first mate. The same request id again returns the answer it already is, so a resend after a lost reply is one answer.
 */
export const submitAnswer = mutation({
  args: { token: v.string(), key: v.string(), kind: v.union(v.literal("approve"), v.literal("deny"), v.literal("answer")), text: v.string(), requestId: v.string() },
  handler: async (ctx, { token, key, kind, text, requestId }) => {
    const device = await deviceOf(ctx, token);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(requestId)) throw new ConvexError("refused: not a request id");
    const now = clock();
    const waiting = await ctx.db.query("waiting").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const forKey = await ctx.db.query("answers").withIndex("by_key", (q) => q.eq("key", key)).collect();
    const recent = (await ctx.db.query("answers").withIndex("by_device", (q) => q.eq("deviceId", device._id).gt("submittedAt", now - 60_000)).collect()).length;
    const companion = await ctx.db.query("companion").first();
    const facts: AnswerRow[] = forKey.map((a) => ({ key: a.key, requestId: a.requestId, status: a.status, submittedAt: a.submittedAt }));
    const verdict = judgeSubmit({ now, companionBeatAt: companion?.heartbeatAt ?? null, kind, text, requestId, forKey: facts, recent });
    if ("replay" in verdict) return { status: verdict.replay.status, requestId };
    if ("refused" in verdict) return { refused: verdict.refused, why: verdict.why };
    if (!waiting || waiting.closedAt !== undefined) return { refused: "not_open" as const, why: "No longer waiting" };
    await ctx.db.insert("answers", { key, kind, text: kind === "answer" ? text : "", requestId, deviceId: device._id, submittedAt: now, status: "pending" });
    return { status: "pending" as const, requestId };
  },
});

/** This phone's push subscription, replacing its last. */
export const subscribe = mutation({
  args: { token: v.string(), subscription: v.object({ endpoint: v.string(), p256dh: v.string(), auth: v.string() }) },
  handler: async (ctx, { token, subscription }) => {
    const device = await deviceOf(ctx, token);
    const { endpoint, p256dh, auth } = subscription;
    if (!endpoint.startsWith("https://") || endpoint.length > 1_000 || p256dh.length > 200 || auth.length > 100) throw new ConvexError("refused: not a push subscription");
    await ctx.db.patch(device._id, { subscription, lastSeenAt: clock() });
  },
});
