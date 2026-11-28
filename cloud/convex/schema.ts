// The cloud store's tables (build spec §11.2; ADR 0023). Every field a table holds is listed; the database refuses a
// document with any other. Summaries only: the one thing here that is not the factory's own state is a device's push
// subscription and the hashes that let a phone or the companion in.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { summary } from "./lib/summary.ts";

const nullableNumber = v.union(v.number(), v.null());

export default defineSchema({
  /** One row: when the companion last beat, and which build it is. */
  companion: defineTable({ heartbeatAt: v.number(), version: v.string(), label: v.string() }),
  /** One row, replaced whole: the latest summary. */
  reading: defineTable({ summary }),
  /** An item waiting on the captain, kept 30 days after it closes. `key` is `<task>@<key>@<opened_at>`. */
  waiting: defineTable({
    key: v.string(),
    task: v.string(),
    project: v.string(),
    title: v.string(),
    question: v.string(),
    recommendation: v.union(v.string(), v.null()),
    since: v.number(),
    closedAt: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
  /** An answer from a phone, kept with its item. */
  answers: defineTable({
    key: v.string(),
    kind: v.union(v.literal("approve"), v.literal("deny"), v.literal("answer")),
    text: v.string(),
    requestId: v.string(),
    deviceId: v.id("devices"),
    submittedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("already"), v.literal("not_open"), v.literal("expired")),
    settledAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    reply: v.optional(v.string()),
  })
    .index("by_requestId", ["requestId"])
    .index("by_key", ["key"])
    .index("by_device", ["deviceId", "submittedAt"])
    .index("by_status", ["status", "submittedAt"]),
  /** A paired phone. Remove deletes the row: the one delete, of a credential and not a record. */
  devices: defineTable({
    name: v.string(),
    tokenHash: v.string(),
    pairedAt: v.number(),
    lastSeenAt: v.number(),
    subscription: v.optional(v.object({ endpoint: v.string(), p256dh: v.string(), auth: v.string() })),
  }).index("by_tokenHash", ["tokenHash"]),
  /** A pairing in progress: the SHA-256 of its code, never the code. */
  pairings: defineTable({ codeHash: v.string(), expiresAt: v.number(), usedAt: v.optional(v.number()), tries: v.number() }).index("by_expiresAt", ["expiresAt"]),
  /** The factory's events, immutable and never deleted (slice 11). */
  factory_events: defineTable({ task: v.string(), project: v.string(), event: v.string(), at: v.number(), value: v.optional(nullableNumber) }).index("by_at", ["at"]).index("by_key", ["task", "event", "at"]),
  /** The last "unreachable" and "back" pushed, so a change sends one push. */
  alerts: defineTable({ kind: v.union(v.literal("unreachable"), v.literal("back")), at: v.number() }).index("by_kind", ["kind"]),
});
