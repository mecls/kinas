// The tables a push reads and writes (build spec §11.3 C). A "use node" file may hold actions only, so push.ts calls these.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Every phone that has allowed notifications: its id and subscription. */
export const subscribed = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("devices").collect()).flatMap((d) => (d.subscription ? [{ id: d._id, subscription: d.subscription }] : [])),
});

/** An item still waiting and not yet notified: what a notification may be made from. */
export const itemToNotify = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const w = await ctx.db.query("waiting").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!w || w.closedAt !== undefined || w.notifiedAt !== undefined) return null;
    return { key: w.key, project: w.project, title: w.title, question: w.question };
  },
});

export const markNotified = internalMutation({
  args: { key: v.string(), at: v.number() },
  handler: async (ctx, { key, at }) => {
    const w = await ctx.db.query("waiting").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (w && w.notifiedAt === undefined) await ctx.db.patch(w._id, { notifiedAt: at });
  },
});

/** The push service said this subscription is gone (404 or 410): the phone has none until it subscribes again. */
export const clearSubscription = internalMutation({
  args: { id: v.id("devices") },
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get(id);
    if (d) await ctx.db.patch(id, { subscription: undefined });
  },
});

export const lastAlert = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("alerts").collect();
    const last = rows.sort((a, b) => b.at - a.at)[0];
    return last ? { kind: last.kind, at: last.at } : null;
  },
});

export const recordAlert = internalMutation({
  args: { kind: v.union(v.literal("unreachable"), v.literal("back")), at: v.number() },
  handler: async (ctx, { kind, at }) => {
    await ctx.db.insert("alerts", { kind, at });
  },
});

export const companionFacts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const c = await ctx.db.query("companion").first();
    return c ? { beatAt: c.heartbeatAt, label: c.label } : null;
  },
});
