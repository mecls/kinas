import { describe, expect, test } from "bun:test";
import type { StatusResult, StatusQuota } from "./status.ts";
import { statusLines } from "./status.ts";

const NOW = 1_790_000_000_000;

const usage = (tokens_in: number, tokens_cache_read: number, tokens_out: number) => ({
  date: "2026-09-14",
  harness: "claude-code" as const,
  provider: "anthropic",
  model: "claude-opus-5",
  tokens_in,
  tokens_cache_read,
  tokens_out,
  messages: 1,
});

const result = (usageToday: StatusResult["usageToday"]): StatusResult => ({ now: NOW, quotas: [] as StatusQuota[], missing: [], usageToday, host: null });

const todayLine = (r: StatusResult) => statusLines(r, false).find((l) => l.startsWith("  claude-code"))!;

describe("kinas status's compact token counts", () => {
  test("950 · 34k · 1.3M · 6.1B — the Usage page's own numbers (README: the Usage page as text), from the one shared rule", () => {
    expect(todayLine(result([usage(950, 34_000, 1_250_000)]))).toBe("  claude-code · claude-opus-5     in 950 · cache 34k · out 1.3M · 1 msg");
    // Three significant figures as the page shows them: 150,400 is 150k and 999,600 is 1M here too, not 150.4k and 999.6k.
    expect(todayLine(result([usage(6_130_000_000, 150_400, 999_600)]))).toContain("in 6.1B · cache 150k · out 1M");
  });

  test("a count that rounds to a unit's ceiling moves up a unit, as the Usage page's compactTokens does: never 1000k or 1000M", () => {
    expect(todayLine(result([usage(999_950, 999_999, 999_950_000)]))).toContain("in 1M · cache 1M · out 1B");
    expect(todayLine(result([usage(1_000_000, 1_000, 1_000_000_000)]))).toContain("in 1M · cache 1k · out 1B");
  });
});
