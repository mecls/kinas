// An independent recount of interactive token usage, written separately from the Rust logs reader so
// the two can check each other (PRD §5.7, AC-5). Rules: PRD R20–R23.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface UsageRow {
  date: string;
  harness: "claude-code" | "pi";
  provider: string;
  model: string;
  tokens_in: number;
  tokens_cache_read: number;
  tokens_out: number;
  messages: number;
}

const lisbon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The shapes the Rust reader's `jiff::Timestamp` parses (logs.rs `lisbon_date`): a date, `T` or a space, a time, and
 * always an offset. JavaScript's `Date` would also take a date alone, a zoneless time or `Sep 10 2026`, and the two
 * must agree line for line (AC-5).
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/** The Lisbon date of an RFC 3339 timestamp; null when it does not parse — such a line is malformed and skipped (R25). */
export function lisbonDate(timestamp: string): string | null {
  if (!RFC3339.test(timestamp)) return null;
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? null : lisbon.format(at);
}

function jsonlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

function* lines(file: string): Generator<Record<string, unknown>> {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {
      // R25: malformed lines are skipped.
    }
  }
}

interface Counted {
  date: string;
  timestamp: string;
  harness: UsageRow["harness"];
  provider: string;
  model: string;
  in: number;
  cacheRead: number;
  out: number;
}

/** A token count, whole: a fraction is cut, not rounded, as the Rust reader's `int` cuts it (logs.rs). */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
/** A model or provider that is not a string reads "unknown", as the Rust reader has it (logs.rs). */
const name = (v: unknown) => (typeof v === "string" ? v : "unknown");
/** A JSON object, or null for anything else: a `usage` that is an array, a string or a number counts nothing in Rust (`is_object`). */
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function recount(claudeRoot: string, piRoot: string): UsageRow[] {
  const messages = new Map<string, Counted>();

  // Claude Code: one message per message.id across every file; its largest-output line wins (R21).
  for (const file of jsonlFiles(claudeRoot).sort()) {
    for (const j of lines(file)) {
      const m = obj(j.message);
      const usage = obj(m?.usage);
      if (j.type !== "assistant" || !m || !usage || typeof m.id !== "string" || typeof j.timestamp !== "string") continue;
      if (m.model === "<synthetic>") continue;
      const date = lisbonDate(j.timestamp);
      if (date === null) continue;
      const candidate: Counted = {
        date,
        timestamp: j.timestamp,
        harness: "claude-code",
        provider: "anthropic",
        model: name(m.model),
        in: num(usage.input_tokens) + num(usage.cache_creation_input_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        out: num(usage.output_tokens),
      };
      const key = `claude-code:${m.id}`;
      const seen = messages.get(key);
      // A later line with more output replaces the tokens only: the message keeps the date, provider and model of its
      // first line, as the Rust reader's usage_seen row does.
      if (!seen) messages.set(key, candidate);
      else if (candidate.out > seen.out) messages.set(key, { ...seen, in: candidate.in, cacheRead: candidate.cacheRead, out: candidate.out });
    }
  }

  // Pi: entries are unique per file; key is <file name>:<entry id>.
  for (const file of jsonlFiles(piRoot).sort()) {
    const fileName = file.split("/").pop()!;
    for (const j of lines(file)) {
      const m = obj(j.message);
      const usage = obj(m?.usage);
      if (j.type !== "message" || !m || !usage || typeof j.id !== "string" || typeof j.timestamp !== "string") continue;
      const date = lisbonDate(j.timestamp);
      if (date === null) continue;
      messages.set(`pi:${fileName}:${j.id}`, {
        date,
        timestamp: j.timestamp,
        harness: "pi",
        provider: name(m.provider),
        model: name(m.model),
        in: num(usage.input) + num(usage.cacheWrite),
        cacheRead: num(usage.cacheRead),
        out: num(usage.output),
      });
    }
  }

  const rows = new Map<string, UsageRow>();
  for (const c of messages.values()) {
    // Spelled as an escape: a raw NUL in the source made git read this file as binary.
    const key = [c.date, c.harness, c.provider, c.model].join("\0");
    const row = rows.get(key) ?? { date: c.date, harness: c.harness, provider: c.provider, model: c.model, tokens_in: 0, tokens_cache_read: 0, tokens_out: 0, messages: 0 };
    row.tokens_in += c.in;
    row.tokens_cache_read += c.cacheRead;
    row.tokens_out += c.out;
    row.messages += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => [a.date, a.harness, a.provider, a.model].join("|").localeCompare([b.date, b.harness, b.provider, b.model].join("|")));
}
