// What the cloud store may hold (ADR 0023; build spec §6.4 and §11.2): a summary of the factory and nothing else — no
// code, diff, brief, report, transcript, path, branch name, log or key. This file is the one list of its fields, as
// Convex validators, with the caps on its strings. The companion's `summaryOf` copies exactly these fields; a Convex
// function refuses a summary with any other (`conforms`), or with a string over its cap (`capsViolation`).

import { v, type Infer, type Validator } from "convex/values";

export const CAPS = {
  question: 2_000,
  title: 200,
  recommendation: 500,
  project: 100,
  task: 128,
  /** `<task>@<key>@<opened_at>`. */
  key: 300,
  label: 32,
  kind: 40,
  harness: 40,
  checks: 40,
  reply: 2_000,
  /** The words an answer types, in UTF-8 bytes: the Mac's own cap (`fixtures/answer-lines.json`). */
  words: 4_096,
  deviceName: 60,
  version: 40,
} as const;

/** `packages/commands`'s CrewWord, as strings: the phone draws the same words. */
export const WORDS = ["queued", "working", "needs decision", "blocked", "in review", "CI red", "PR open", "ready", "done", "failed", "paused", "unknown", "gone"] as const;

const nullable = <T extends Validator<any, any, any>>(x: T) => v.union(x, v.null());

export const summaryTask = v.object({
  task: v.string(),
  project: v.string(),
  title: v.string(),
  word: v.union(...WORDS.map((w) => v.literal(w))),
  kind: v.string(),
  harness: nullable(v.string()),
  elapsedS: nullable(v.number()),
  pr: nullable(v.number()),
  checks: nullable(v.string()),
});

export const summaryItem = v.object({
  key: v.string(),
  task: v.string(),
  project: v.string(),
  title: v.string(),
  question: v.string(),
  recommendation: nullable(v.string()),
  since: v.number(),
});

export const summary = v.object({
  v: v.literal(1),
  asOf: v.number(),
  label: v.string(),
  board: v.array(summaryTask),
  waiting: v.array(summaryItem),
  counts: v.object({ tasks: v.number(), working: v.number(), waiting: v.number(), blocked: v.number(), inReview: v.number() }),
  usage: v.object({ planWeekPct: nullable(v.number()), planSessionPct: nullable(v.number()) }),
  host: v.object({ cpu: v.number(), memPct: v.number(), diskPct: v.number() }),
  heartbeatAt: v.number(),
  lanes: nullable(v.object({ free: nullable(v.number()), cap: nullable(v.number()) })),
});

export type Summary = Infer<typeof summary>;
export type SummaryTask = Infer<typeof summaryTask>;
export type SummaryItem = Infer<typeof summaryItem>;

/** The characters of every string field are capped, so a long one can't carry a file's contents out. */
export function capsViolation(s: Summary): string | null {
  const over = (value: string | null, max: number, name: string) => (value !== null && [...value].length > max ? `${name} is over ${max} characters` : null);
  const first = (...xs: (string | null)[]) => xs.find((x) => x !== null) ?? null;
  const items = s.waiting.map((w) => first(over(w.key, CAPS.key, "key"), over(w.task, CAPS.task, "task"), over(w.project, CAPS.project, "project"), over(w.title, CAPS.title, "title"), over(w.question, CAPS.question, "question"), over(w.recommendation, CAPS.recommendation, "recommendation")));
  const tasks = s.board.map((t) => first(over(t.task, CAPS.task, "task"), over(t.project, CAPS.project, "project"), over(t.title, CAPS.title, "title"), over(t.kind, CAPS.kind, "kind"), over(t.harness, CAPS.harness, "harness"), over(t.checks, CAPS.checks, "checks")));
  return first(over(s.label, CAPS.label, "label"), ...items, ...tasks);
}

type Json = { type: string; value?: unknown; fieldType?: Json; optional?: boolean };

/**
 * Whether `value` is exactly what `validator` describes — an unknown field in an object is refused, as the database's
 * own check does — and why not, in words that name no value. Convex runs its validators on every write; this runs the
 * same walk in a test (and before a write), so "an unknown field is rejected" is proven without a deployment.
 */
export function conforms(validator: Validator<any, any, any>, value: unknown, path = "summary"): string | null {
  return walk((validator as unknown as { json: Json }).json, value, path);
}

function walk(j: Json, value: unknown, path: string): string | null {
  switch (j.type) {
    case "string":
      return typeof value === "string" ? null : `${path} is not a string`;
    case "number":
    case "float64":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} is not a number`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} is not a boolean`;
    case "null":
      return value === null ? null : `${path} is not null`;
    case "literal":
      return value === j.value ? null : `${path} is not ${JSON.stringify(j.value)}`;
    case "array": {
      if (!Array.isArray(value)) return `${path} is not an array`;
      for (let i = 0; i < value.length; i++) {
        const why = walk(j.value as Json, value[i], `${path}[${i}]`);
        if (why) return why;
      }
      return null;
    }
    case "union": {
      const options = j.value as Json[];
      for (const o of options) if (walk(o, value, path) === null) return null;
      return `${path} matches none of its shapes`;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return `${path} is not an object`;
      const fields = j.value as Record<string, { fieldType: Json; optional: boolean }>;
      for (const key of Object.keys(value as object)) if (!(key in fields)) return `${path} has a field the store doesn't hold: ${key}`;
      for (const [key, f] of Object.entries(fields)) {
        const present = key in (value as object) && (value as Record<string, unknown>)[key] !== undefined;
        if (!present) {
          if (f.optional) continue;
          return `${path}.${key} is missing`;
        }
        const why = walk(f.fieldType, (value as Record<string, unknown>)[key], `${path}.${key}`);
        if (why) return why;
      }
      return null;
    }
    default:
      return `${path} has a shape this check doesn't know (${j.type})`;
  }
}
