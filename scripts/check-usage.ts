#!/usr/bin/env bun
// PRD §5.7 / AC-5: recount token usage straight from the transcripts and compare with a Kinas store.
//
//   bun scripts/check-usage.ts                          compare the 3 most recent dates in the store
//   bun scripts/check-usage.ts --store <kinas.sqlite>   a different store
//   bun scripts/check-usage.ts --dates 2026-09-12,2026-09-13
//   KINAS_CLAUDE_PROJECTS_DIR / KINAS_PI_SESSIONS_DIR   other transcript roots
//
// Exits 0 when every compared (date, harness, provider, model) matches exactly, 1 otherwise.

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { recount, type UsageRow } from "./usage-recount.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const store = option("--store") ?? join(homedir(), "Library/Application Support/ai.sintralabs.kinas/kinas.sqlite");
const claudeRoot = process.env.KINAS_CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude/projects");
const piRoot = process.env.KINAS_PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");

const db = new Database(`file:${store}?mode=ro`, { readonly: true });
const stored = db
  .query(
    `SELECT date, harness, provider, model, sum(tokens_in) AS tokens_in, sum(tokens_cache_read) AS tokens_cache_read,
            sum(tokens_out) AS tokens_out, sum(messages) AS messages
     FROM usage_daily GROUP BY date, harness, provider, model ORDER BY date, harness, provider, model`,
  )
  .all() as UsageRow[];

const dates =
  option("--dates")?.split(",") ??
  [...new Set(stored.map((r) => r.date))].sort().slice(-3);

const fresh = recount(claudeRoot, piRoot);
const key = (r: UsageRow) => [r.date, r.harness, r.provider, r.model].join(" | ");
const pick = (rows: UsageRow[]) => new Map(rows.filter((r) => dates.includes(r.date)).map((r) => [key(r), r]));
const want = pick(fresh);
const got = pick(stored);

let mismatches = 0;
for (const k of [...new Set([...want.keys(), ...got.keys()])].sort()) {
  const a = want.get(k);
  const b = got.get(k);
  const same = a && b && a.tokens_in === b.tokens_in && a.tokens_cache_read === b.tokens_cache_read && a.tokens_out === b.tokens_out && a.messages === b.messages;
  if (!same) mismatches++;
  const fmt = (r?: UsageRow) => (r ? `in ${r.tokens_in} · cache ${r.tokens_cache_read} · out ${r.tokens_out} · msgs ${r.messages}` : "missing");
  console.log(`${same ? "ok  " : "DIFF"} ${k}\n     transcripts: ${fmt(a)}\n     store:       ${fmt(b)}`);
}
console.log(`\n${dates.length} date(s): ${dates.join(", ")} — ${mismatches === 0 ? "all rows match" : `${mismatches} mismatch(es)`}`);
process.exit(mismatches === 0 ? 0 : 1);
