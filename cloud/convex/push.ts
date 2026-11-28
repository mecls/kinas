"use node";

// Sending a push (build spec §11.3 C; slice 9): Web Push with the deployment's VAPID keys, to each phone that has allowed
// notifications. A 404 or 410 from the push service clears that phone's subscription. A key missing means no push and a
// log line saying which name is missing, never a value. The payload is built by lib/push.ts and checked before it is sent.

import { v } from "convex/values";
import * as webpush from "web-push";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { alertVerdict, backPayload, itemPayload, payloadViolation, testPayload, unreachablePayload, type Payload } from "./lib/push.ts";

const ZONE = process.env.KINAS_TIME_ZONE ?? "Europe/Lisbon";

/** Send `payload` to every subscribed phone; returns how many were reached. */
async function deliver(ctx: ActionCtx, payload: Payload): Promise<number> {
  const why = payloadViolation(payload);
  if (why) {
    console.log(`push: payload refused (${why})`);
    return 0;
  }
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  const missing = (["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const).filter((k) => !process.env[k]);
  if (missing.length > 0 || !pub || !priv || !subject) {
    console.log(`push: not sent, ${missing.join(", ")} not set`);
    return 0;
  }
  webpush.setVapidDetails(subject, pub, priv);
  let reached = 0;
  for (const d of await ctx.runQuery(internal.pushData.subscribed, {})) {
    try {
      await webpush.sendNotification({ endpoint: d.subscription.endpoint, keys: { p256dh: d.subscription.p256dh, auth: d.subscription.auth } }, JSON.stringify(payload), { TTL: 3600, timeout: 10_000 });
      reached++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await ctx.runMutation(internal.pushData.clearSubscription, { id: d.id });
      else console.log(`push: a phone was not reached (${status ?? "error"})`);
    }
  }
  return reached;
}

/** One push for one new item waiting on the captain. Marked notified once it is sent, so a retry can't send a second. */
export const notifyItem = internalAction({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ sent: number }> => {
    const item = await ctx.runQuery(internal.pushData.itemToNotify, { key });
    if (!item) return { sent: 0 };
    const sent = await deliver(ctx, itemPayload(item));
    await ctx.runMutation(internal.pushData.markNotified, { key, at: Date.now() });
    return { sent };
  },
});

/** The heartbeat watch's push, once per change: unreachable for ten minutes, and back. */
export const notifyAlert = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const facts = await ctx.runQuery(internal.pushData.companionFacts, {});
    if (!facts) return { sent: 0 };
    const now = Date.now();
    const verdict = alertVerdict({ beatAt: facts.beatAt, now, last: await ctx.runQuery(internal.pushData.lastAlert, {}) });
    if (verdict === null) return { sent: 0 };
    await ctx.runMutation(internal.pushData.recordAlert, { kind: verdict, at: now });
    return { sent: await deliver(ctx, verdict === "unreachable" ? unreachablePayload(facts.label, facts.beatAt, ZONE) : backPayload(facts.label)) };
  },
});

/** Settings' Send a test notification. */
export const sendTest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => ({ sent: await deliver(ctx, testPayload()) }),
});
