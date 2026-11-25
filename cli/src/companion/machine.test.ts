import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cpuSample, hostNow, lastAssistantAt, PLAN_LIMIT, planNow, RECOUNT_GAP_MS, usageNow } from "./machine.ts";

// The Linux machine's plan hand-off, host and token counts for the Mac's Usage page (build spec §12 slice 5.1).

const dir = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
const SESSION = "0f3a9c2e-1b2c-4d5e-8f90-123456789abc";
const assistant = (ts: string, id = "m1", out = 7) =>
  JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: "claude-opus-5-5", usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 100, output_tokens: out } } });

describe("the plan hand-off", () => {
  test("is passed verbatim, with the file's time and the session transcript's last assistant line, read on this machine", () => {
    const state = dir("kinas-state-");
    const claude = dir("kinas-claude-");
    const text = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12 } }, session_id: SESSION, captured_at: 1_795_640_000_000 });
    put(state, "claude-rate-limits.json", text);
    utimesSync(join(state, "claude-rate-limits.json"), 1_795_640_001, 1_795_640_001);
    put(claude, `projects/-home-claude-projects-shop/${SESSION}.jsonl`, `${assistant("2026-11-25T20:00:00Z")}\n${assistant("2026-11-25T20:05:00.250Z", "m2")}\n{"type":"user","timestamp":"2026-11-25T20:06:00Z"}\n`);
    expect(planNow(state, claude)).toEqual({ text, file_at: 1_795_640_001_000, last_assistant_at: Date.parse("2026-11-25T20:05:00.250Z") });
  });

  test("none without the file; no transcript time for a session id that isn't one, or a transcript that isn't there", () => {
    const state = dir("kinas-state-");
    const claude = dir("kinas-claude-");
    expect(planNow(state, claude)).toBeNull();
    put(state, "claude-rate-limits.json", JSON.stringify({ rate_limits: {}, session_id: "../../etc/passwd" }));
    expect(planNow(state, claude)?.last_assistant_at).toBeNull();
    put(state, "claude-rate-limits.json", JSON.stringify({ rate_limits: {}, session_id: SESSION }));
    expect(planNow(state, claude)?.last_assistant_at).toBeNull();
    expect(lastAssistantAt(join(claude, "projects"), SESSION)).toBeNull();
  });

  test("a link, a file over the limit or not a regular file is never read", () => {
    const state = dir("kinas-state-");
    const claude = dir("kinas-claude-");
    put(state, "elsewhere.json", "{}");
    symlinkSync(join(state, "elsewhere.json"), join(state, "claude-rate-limits.json"));
    expect(planNow(state, claude)).toBeNull();
    const big = dir("kinas-state-");
    put(big, "claude-rate-limits.json", "x".repeat(PLAN_LIMIT + 1));
    expect(planNow(big, claude)).toBeNull();
  });
});

describe("the host", () => {
  function proc(stat: string, meminfo: string) {
    const root = dir("kinas-proc-");
    put(root, "stat", stat);
    put(root, "meminfo", meminfo);
    return root;
  }
  const MEM = "MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    4096000 kB\n";

  test("CPU is the busy share between two readings; memory is total less available; disk from statfs, in GiB", () => {
    const first = proc("cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1\n", MEM);
    const a = cpuSample(first);
    expect(a).toEqual({ busy: 200, total: 1000 });
    const second = proc("cpu  250 0 150 1000 100 0 0 0 0 0\n", MEM);
    const host = hostNow(second, dir("kinas-disk-"), a);
    // busy 400 − 200 over total 1500 − 1000: 40 %.
    expect(host.out?.cpu_pct).toBe(40);
    expect(host.out?.mem_total_gb).toBeCloseTo(16384000 / 1024 / 1024, 6);
    expect(host.out?.mem_used_gb).toBeCloseTo((16384000 - 4096000) / 1024 / 1024, 6);
    expect(host.out!.disk_total_gb).toBeGreaterThan(0);
    expect(host.out!.disk_used_gb).toBeLessThanOrEqual(host.out!.disk_total_gb);
    expect(host.out!.disk_available_gb).toBeLessThanOrEqual(host.out!.disk_total_gb);
    expect(host.cpu).toEqual({ busy: 400, total: 1500 });
  });

  test("no CPU figure on the first reading, or when the counters didn't move; none at all without /proc", () => {
    const p = proc("cpu  100 0 100 700 100 0 0 0 0 0\n", MEM);
    expect(hostNow(p, dir("kinas-disk-"), null).out?.cpu_pct).toBeNull();
    expect(hostNow(p, dir("kinas-disk-"), { busy: 200, total: 1000 }).out?.cpu_pct).toBeNull();
    expect(hostNow(dir("kinas-noproc-"), dir("kinas-disk-"), null)).toEqual({ out: null, cpu: null });
  });
});

describe("the token counts", () => {
  test("the same recount as the Mac's, over this machine's transcripts, the last 31 days, at most once every 5 minutes", () => {
    const claude = dir("kinas-claude-");
    const now = Date.parse("2026-11-25T21:00:00Z");
    put(claude, "projects/-home-claude-wt/a.jsonl", [assistant("2026-11-25T10:00:00Z", "m1", 7), assistant("2026-11-25T10:00:01Z", "m1", 9), assistant("2026-09-01T10:00:00Z", "old")].join("\n"));
    const first = usageNow(claude, null, now);
    expect(first.counted_at).toBe(now);
    expect(first.rows).toEqual([
      { date: "2026-11-25", harness: "claude-code", provider: "anthropic", model: "claude-opus-5-5", tokens_in: 12, tokens_cache_read: 100, tokens_out: 9, messages: 1 },
    ]);
    // Within the gap the last count stands, even if a transcript grew; after it, a new count.
    put(claude, "projects/-home-claude-wt/b.jsonl", assistant("2026-11-25T11:00:00Z", "m3", 1));
    expect(usageNow(claude, first, now + RECOUNT_GAP_MS - 1)).toBe(first);
    expect(usageNow(claude, first, now + RECOUNT_GAP_MS).rows[0]?.messages).toBe(2);
    // A clock that stepped back counts again rather than trusting a count from the future.
    expect(usageNow(claude, first, now - 1).counted_at).toBe(now - 1);
  });
});
