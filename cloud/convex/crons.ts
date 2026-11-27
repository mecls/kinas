// What the deployment does on its own (build spec §11.2): expire answers the companion didn't take in a minute, and drop
// what closed a month ago. The heartbeat watch and the pushes arrive with slice 9.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { ANSWER_TTL_MS, isExpired } from "./lib/answers.ts";
import { retentionCutoff } from "./lib/waiting.ts";

/** A pending answer older than 60 s is never delivered (§6.5): it is marked expired, and the phone says so. */
export const expirePendingAnswers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db.query("answers").withIndex("by_status", (q) => q.eq("status", "pending").lt("submittedAt", now - ANSWER_TTL_MS)).collect();
    let expired = 0;
    for (const a of pending) {
      if (!isExpired(a, now)) continue;
      await ctx.db.patch(a._id, { status: "expired", settledAt: now });
      expired++;
    }
    return { expired };
  },
});

/** Items closed over thirty days ago, and the answers kept with them. Summaries aren't records; events are, and stay. */
export const dropClosed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = retentionCutoff(Date.now());
    let dropped = 0;
    for (const w of await ctx.db.query("waiting").collect()) {
      if (w.closedAt === undefined || w.closedAt > cutoff) continue;
      for (const a of await ctx.db.query("answers").withIndex("by_key", (q) => q.eq("key", w.key)).collect()) await ctx.db.delete(a._id);
      await ctx.db.delete(w._id);
      dropped++;
    }
    return { dropped };
  },
});

const crons = cronJobs();
crons.interval("expire pending answers", { minutes: 1 }, internal.crons.expirePendingAnswers, {});
crons.interval("drop closed items", { hours: 24 }, internal.crons.dropClosed, {});
export default crons;
