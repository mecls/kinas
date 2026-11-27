// What the companion on the Linux machine may do (build spec §8, §11.2): every function starts with its secret, checked
// against `COMPANION_SECRET_SHA256` before anything is read or written. A summary that isn't exactly ADR 0023's list,
// or has a string over its cap, is refused whole.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { PAIR_TTL_MS, companionOk } from "./lib/auth.ts";
import { takeable } from "./lib/answers.ts";
import { CAPS, capsViolation, conforms, summary } from "./lib/summary.ts";
import { diffWaiting, splitKey } from "./lib/waiting.ts";

export async function requireCompanion(secret: string): Promise<void> {
  if (!(await companionOk(secret, process.env.COMPANION_SECRET_SHA256))) throw new ConvexError("refused");
}

async function companionRow(ctx: QueryCtx) {
  return await ctx.db.query("companion").first();
}

/** The latest summary, replaced whole; the items waiting follow it: new ones open, ones it dropped close. */
export const replaceReading = mutation({
  args: { secret: v.string(), summary },
  handler: async (ctx, { secret, summary: s }) => {
    await requireCompanion(secret);
    const wrong = conforms(summary, s) ?? capsViolation(s);
    if (wrong) throw new ConvexError(`refused: ${wrong}`);
    const row = await ctx.db.query("reading").first();
    if (row) await ctx.db.replace(row._id, { summary: s });
    else await ctx.db.insert("reading", { summary: s });

    const existing = await ctx.db.query("waiting").collect();
    const diff = diffWaiting(existing, s.waiting);
    for (const item of diff.open) await ctx.db.insert("waiting", { key: item.key, task: item.task, project: item.project, title: item.title, question: item.question, recommendation: item.recommendation, since: item.since });
    for (const key of diff.close) {
      const w = existing.find((r) => r.key === key);
      if (w) await ctx.db.patch(w._id, { closedAt: s.asOf });
    }
    for (const key of diff.reopen) {
      const w = existing.find((r) => r.key === key);
      if (w) await ctx.db.patch(w._id, { closedAt: undefined });
    }
    // One push for each item the store hasn't seen, within the minute: the action marks it notified once it is sent.
    for (const item of diff.open) await ctx.scheduler.runAfter(0, internal.push.notifyItem, { key: item.key });
    return { opened: diff.open.map((i) => i.key), closed: diff.close.length };
  },
});

export const heartbeat = mutation({
  args: { secret: v.string(), at: v.number(), version: v.string(), label: v.string() },
  handler: async (ctx, { secret, at, version, label }) => {
    await requireCompanion(secret);
    if ([...version].length > CAPS.version || [...label].length > CAPS.label) throw new ConvexError("refused: version or label is too long");
    const row = await companionRow(ctx);
    if (row) await ctx.db.patch(row._id, { heartbeatAt: at, version, label });
    else await ctx.db.insert("companion", { heartbeatAt: at, version, label });
  },
});

/** The phones' answers the companion has yet to deliver and may still deliver (never after 60 s). */
export const takeAnswers = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    await requireCompanion(secret);
    const pending = await ctx.db.query("answers").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
    const now = Date.now();
    return pending
      .filter((a) => takeable(a, now))
      .flatMap((a) => {
        const k = splitKey(a.key);
        return k ? [{ requestId: a.requestId, key: a.key, task: k.task, decision: k.decision, kind: a.kind, text: a.text, submittedAt: a.submittedAt }] : [];
      });
  },
});

export const settleAnswer = mutation({
  args: {
    secret: v.string(),
    requestId: v.string(),
    outcome: v.union(v.literal("delivered"), v.literal("already"), v.literal("not_open"), v.literal("expired"), v.literal("read")),
    at: v.number(),
    reply: v.optional(v.string()),
  },
  handler: async (ctx, { secret, requestId, outcome, at, reply }) => {
    await requireCompanion(secret);
    if (reply !== undefined && [...reply].length > CAPS.reply) throw new ConvexError("refused: the reply is too long");
    const a = await ctx.db.query("answers").withIndex("by_requestId", (q) => q.eq("requestId", requestId)).unique();
    if (!a) return { settled: false };
    if (outcome === "read") {
      if (a.status !== "delivered") return { settled: false };
      await ctx.db.patch(a._id, { readAt: at, ...(reply !== undefined ? { reply } : {}) });
    } else {
      // Only a pending answer settles; a late echo of an earlier call changes nothing.
      if (a.status !== "pending") return { settled: false };
      await ctx.db.patch(a._id, { status: outcome, settledAt: at });
    }
    return { settled: true };
  },
});

/** One pairing at a time: starting a new one ends any open one. */
export const startPairing = mutation({
  args: { secret: v.string(), codeHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, { secret, codeHash, expiresAt }) => {
    await requireCompanion(secret);
    if (!/^[0-9a-f]{64}$/.test(codeHash)) throw new ConvexError("refused: not a hash");
    const now = Date.now();
    if (expiresAt > now + PAIR_TTL_MS + 60_000) throw new ConvexError("refused: a pairing lasts ten minutes");
    for (const p of await ctx.db.query("pairings").collect()) if (p.usedAt === undefined && p.expiresAt > now) await ctx.db.patch(p._id, { expiresAt: now });
    await ctx.db.insert("pairings", { codeHash, expiresAt, tries: 0 });
  },
});

export const phones = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    await requireCompanion(secret);
    return (await ctx.db.query("devices").collect()).map((d) => ({ id: d._id, name: d.name, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, push: d.subscription !== undefined }));
  },
});

/** Remove a phone: its row goes, so its token stops working. The one delete here, of a credential and not a record. */
export const unpair = mutation({
  args: { secret: v.string(), id: v.id("devices") },
  handler: async (ctx: MutationCtx, { secret, id }) => {
    await requireCompanion(secret);
    const d = await ctx.db.get(id);
    if (!d) return { removed: false };
    await ctx.db.delete(id);
    return { removed: true };
  },
});

/** Settings' Send a test notification: one push to every phone that has allowed them. */
export const testNotification = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    await requireCompanion(secret);
    await ctx.scheduler.runAfter(0, internal.push.sendTest, {});
  },
});
