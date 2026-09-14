import { expect, test } from "bun:test";
import { statusFromStore, statusLines } from "@kinas/commands";
import type { UsageSnapshot } from "../api.ts";
import { snapshotAdapter } from "./snapshotAdapter.ts";

const NOW = 1_789_390_320_000; // 2026-09-14T12:52:00Z = 13:52 in Lisbon

const snapshot: UsageSnapshot = {
  now: NOW,
  quotas: [
    { subscription: "claude-plan", window: "session", used_pct: 42, left_pct: 58, resets_at: 1_789_391_400_000, plan: null, source: "Claude Code status line", updated_at: NOW, state: "fresh", models: [] },
  ],
  readers: [
    { reader: "claude-plan", state: "ok", last_attempt_at: NOW, last_success_at: NOW, last_error: null, stale_after_ms: 1_800_000, dead_after_ms: 43_200_000 },
    { reader: "ollama-cloud", state: "not_configured", last_attempt_at: NOW, last_success_at: null, last_error: "no API key — add one in Settings", stale_after_ms: 600_000, dead_after_ms: 43_200_000 },
  ],
  host: null,
  usage: [
    { date: "2026-09-14", harness: "pi", provider: "ollama", model: "glm-5.3:cloud", tokens_in: 1200, tokens_cache_read: 0, tokens_out: 300, messages: 2 },
    { date: "2026-09-13", harness: "pi", provider: "ollama", model: "glm-5.3:cloud", tokens_in: 1, tokens_cache_read: 0, tokens_out: 1, messages: 1 },
  ],
  first_usage_date: "2026-09-13",
  days: [],
  backfill: { done: 0, total: 0, running: false },
  claude_hook: { state: "receiving", captured_at: NOW, minutes_ago: 0 },
};

test("the palette's Status is the CLI's status, from the snapshot", () => {
  const lines = statusLines(statusFromStore(snapshotAdapter(snapshot), NOW), false);
  expect(lines[0]).toBe("Claude · session   58% left · resets 14:10 · as of 13:52");
  expect(lines).toContain("Ollama             not connected — add an API key in Settings");
  expect(lines.some((l) => l.startsWith("  pi · glm-5.3:cloud") && l.includes("2 msgs"))).toBe(true);
  expect(lines).toContain("This Mac           no reading yet");
});
