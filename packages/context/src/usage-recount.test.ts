import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import expected from "../../../fixtures/transcripts/expected.json";
import { lisbonDate, recount } from "./usage-recount.ts";

const fixtures = join(import.meta.dir, "../../../fixtures/transcripts");

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

test("a usage that is not an object carries no count, as the Rust reader skips it (usage.is_object())", () => {
  const claude = (usage: unknown) => JSON.stringify({ type: "assistant", timestamp: "2026-09-10T10:00:00Z", message: { id: `m-${JSON.stringify(usage)}`, model: "claude-opus-5", usage } });
  const pi = (usage: unknown) => JSON.stringify({ type: "message", id: `e-${JSON.stringify(usage)}`, timestamp: "2026-09-13T10:00:00Z", message: { provider: "ollama", model: "glm", usage } });
  const [c, p] = roots("usage-shape", [claude([]), claude("x"), claude(5), claude(true), claude(null)], [pi([]), pi("x"), pi(1), pi(null)]);
  expect(recount(c, p)).toEqual([]);
});

test("a timestamp is counted only in the RFC 3339 shape the Rust reader parses: an offset is required", () => {
  // JavaScript's Date would take a date alone, a zoneless time or `Sep 10 2026`; jiff's Timestamp does not, and the
  // store would then hold fewer messages than the recount — a DIFF the store did not cause (AC-5).
  for (const bad of ["2026-09-10T10:00:00", "2026-09-10", "Sep 10 2026", "2026-9-10T10:00:00Z", "1726000000"]) expect(lisbonDate(bad), bad).toBeNull();
  for (const good of ["2026-09-10T10:00:00Z", "2026-09-10t10:00:00z", "2026-09-10 10:00:00Z", "2026-09-10T10:00:00.123456789Z", "2026-09-10T10:00:00+01:00", "2026-09-10T10:00:00-0100", "2026-09-10T10:00Z"]) {
    expect(lisbonDate(good), good).toBe("2026-09-10");
  }
  const [c, p] = roots("zoneless", [claudeLine("m1", "2026-09-10T10:00:00", 5, "claude-opus-5"), claudeLine("m2", "2026-09-10T10:00:00+01:00", 7, "claude-opus-5")], []);
  expect(recount(c, p)).toEqual([{ date: "2026-09-10", harness: "claude-code", provider: "anthropic", model: "claude-opus-5", tokens_in: 10, tokens_cache_read: 0, tokens_out: 7, messages: 1 }]);
});

test("a timestamp in the right shape with a value jiff refuses is skipped too: hour 24, second 60, a day the month does not have, an offset past 23 h", () => {
  // JavaScript's Date takes `T24:00:00` as midnight of the next day and February 30th as March 2nd; jiff refuses both,
  // so the recount would hold a message the store never counted (AC-5). The offset rule is the same shape rule as the
  // hour's: Date refuses `+24:00`, and the Rust reader's grammar is held to this one.
  for (const bad of ["2026-09-10T24:00:00Z", "2026-09-10T10:00:60Z", "2026-09-10T10:60:00Z", "2026-02-30T10:00:00Z", "2026-04-31T10:00:00Z", "2027-02-29T10:00:00Z", "2026-13-01T10:00:00Z", "2026-09-00T10:00:00Z", "2026-09-10T10:00:00+24:00", "2026-09-10T10:00:00+01:60"]) {
    expect(lisbonDate(bad), bad).toBeNull();
  }
  expect(lisbonDate("2028-02-29T10:00:00Z")).toBe("2028-02-29");
  expect(lisbonDate("2026-09-10T22:59:59.999Z")).toBe("2026-09-10");
  expect(lisbonDate("2026-09-10T23:00:00Z")).toBe("2026-09-11");
  // The offset is applied, not ignored: 00:30 at +02:00 is 22:30 UTC the evening before, 23:30 in Lisbon's summer.
  expect(lisbonDate("2026-09-10T00:30:00+02:00")).toBe("2026-09-09");
  expect(lisbonDate("2026-09-10T23:30:00-0100")).toBe("2026-09-11");
  const [c, p] = roots("hour-24", [claudeLine("m1", "2026-09-10T24:00:00Z", 5, "claude-opus-5"), claudeLine("m2", "2026-02-30T10:00:00Z", 7, "claude-opus-5")], []);
  expect(recount(c, p)).toEqual([]);
});
