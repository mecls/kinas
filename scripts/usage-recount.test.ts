import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import expected from "../fixtures/transcripts/expected.json";
import { lisbonDate, recount } from "./usage-recount.ts";

const fixtures = join(import.meta.dir, "../fixtures/transcripts");

test("recount of the fixture transcripts matches the hand-derived totals", () => {
  expect(recount(join(fixtures, "claude"), join(fixtures, "pi"))).toEqual(expected.rows as never);
});

test("Lisbon dates across the 2026-10-25 DST change (R23)", () => {
  expect(lisbonDate("2026-10-24T23:30:00Z")).toBe("2026-10-25");
  expect(lisbonDate("2026-10-25T23:30:00Z")).toBe("2026-10-25");
});

test("missing roots count nothing", () => {
  expect(recount("/nonexistent/claude", "/nonexistent/pi")).toEqual([]);
});

// The Rust reader (app/src-tauri/src/readers/logs.rs) and this recount must agree line for line (AC-5): a timestamp
// that does not parse is a malformed line and is skipped, a missing model or provider reads "unknown", and a later line
// of the same message with more output replaces the tokens but keeps the model, provider and date of the first.
const scratch = mkdtempSync(join(tmpdir(), "kinas-recount-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function roots(name: string, claude: string[], pi: string[]): [string, string] {
  const claudeRoot = join(scratch, name, "claude");
  const piRoot = join(scratch, name, "pi");
  mkdirSync(claudeRoot, { recursive: true });
  mkdirSync(piRoot, { recursive: true });
  writeFileSync(join(claudeRoot, "t.jsonl"), `${claude.join("\n")}\n`);
  writeFileSync(join(piRoot, "s.jsonl"), `${pi.join("\n")}\n`);
  return [claudeRoot, piRoot];
}

const claudeLine = (id: string, timestamp: string, out: number, model?: string) =>
  JSON.stringify({ type: "assistant", timestamp, message: { id, ...(model === undefined ? {} : { model }), usage: { input_tokens: 10, output_tokens: out } } });

test("a line whose timestamp does not parse is skipped, as the Rust reader skips it", () => {
  const [c, p] = roots("bad-time", [claudeLine("m1", "not a date", 5, "claude-opus-5"), claudeLine("m2", "2026-09-10T10:00:00Z", 7, "claude-opus-5")], []);
  expect(recount(c, p)).toEqual([{ date: "2026-09-10", harness: "claude-code", provider: "anthropic", model: "claude-opus-5", tokens_in: 10, tokens_cache_read: 0, tokens_out: 7, messages: 1 }]);
});

test("a missing model or provider reads unknown, as in Rust", () => {
  const pi = JSON.stringify({ type: "message", id: "e1", timestamp: "2026-09-13T10:00:00Z", message: { usage: { input: 3, output: 4 } } });
  const [c, p] = roots("no-model", [claudeLine("m1", "2026-09-10T10:00:00Z", 5)], [pi]);
  expect(recount(c, p).map((r) => [r.harness, r.provider, r.model])).toEqual([
    ["claude-code", "anthropic", "unknown"],
    ["pi", "unknown", "unknown"],
  ]);
});

test("the largest output wins the tokens, the first line keeps the model and the date", () => {
  const [c, p] = roots("first-model", [claudeLine("m1", "2026-09-10T10:00:00Z", 5, "claude-opus-5"), claudeLine("m1", "2026-09-11T10:00:00Z", 9, "claude-sonnet-5")], []);
  expect(recount(c, p)).toEqual([{ date: "2026-09-10", harness: "claude-code", provider: "anthropic", model: "claude-opus-5", tokens_in: 10, tokens_cache_read: 0, tokens_out: 9, messages: 1 }]);
});

test("a float token count is cut to its whole part, as the Rust reader cuts it", () => {
  const [c, p] = roots("float-tokens", [claudeLine("m1", "2026-09-10T10:00:00Z", 3.9, "claude-opus-5")], []);
  expect(recount(c, p).map((r) => [r.tokens_in, r.tokens_out])).toEqual([[10, 3]]);
});
