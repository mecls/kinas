import { describe, expect, test } from "bun:test";
import type { UsageDay } from "../api.ts";
import { OTHER, buildChart, niceTicks } from "./chartModel.ts";

const row = (date: string, model: string, tokens_in: number, tokens_out: number, tokens_cache_read = 0, harness: UsageDay["harness"] = "claude-code"): UsageDay => ({
  date,
  harness,
  provider: harness === "pi" ? "ollama" : "anthropic",
  model,
  tokens_in,
  tokens_cache_read,
  tokens_out,
  messages: 1,
});

const days = ["2026-09-12", "2026-09-13", "2026-09-14"];

describe("buildChart", () => {
  test("stacks per day in series order, cache reads only when asked", () => {
    const usage = [row("2026-09-13", "opus", 100, 50, 1000), row("2026-09-13", "glm", 10, 5, 0, "pi"), row("2026-09-14", "opus", 1, 1)];
    const off = buildChart({ usage, days, first_usage_date: "2026-09-13" }, false);
    expect(off.series.map((s) => [s.key, s.slot])).toEqual([
      ["claude-code · opus", 1],
      ["pi · glm", 2],
    ]);
    expect(off.days[1]).toEqual({
      date: "2026-09-13",
      noData: false,
      total: 165,
      segments: [
        { key: "claude-code · opus", value: 150 },
        { key: "pi · glm", value: 15 },
      ],
    });
    const on = buildChart({ usage, days, first_usage_date: "2026-09-13" }, true);
    expect(on.days[1]!.total).toBe(1165);
    expect(on.series.map((s) => s.slot)).toEqual(off.series.map((s) => s.slot));
  });

  test("days before the first reading are no-data, never zero", () => {
    const model = buildChart({ usage: [row("2026-09-14", "opus", 1, 1)], days, first_usage_date: "2026-09-13" }, false);
    expect(model.days.map((d) => d.noData)).toEqual([true, false, false]);
    const empty = buildChart({ usage: [], days, first_usage_date: null }, false);
    expect(empty.days.every((d) => d.noData)).toBe(true);
    expect(empty.ticks).toEqual([0]);
  });

  test("more than 8 series: the 7 largest stay, the rest fold into Other, slots stay alphabetical", () => {
    const usage = Array.from({ length: 10 }, (_, i) => row("2026-09-14", `m${i}`, (i + 1) * 100, 0));
    const model = buildChart({ usage, days, first_usage_date: "2026-09-12" }, false);
    expect(model.series).toHaveLength(8);
    expect(model.series.at(-1)).toMatchObject({ key: OTHER, slot: 8, total: 100 + 200 + 300 });
    expect(model.series.slice(0, 7).map((s) => s.key)).toEqual(["claude-code · m3", "claude-code · m4", "claude-code · m5", "claude-code · m6", "claude-code · m7", "claude-code · m8", "claude-code · m9"]);
  });
});

test("niceTicks", () => {
  expect(niceTicks(0)).toEqual([0]);
  expect(niceTicks(9)).toEqual([0, 5, 10]);
  expect(niceTicks(165)).toEqual([0, 50, 100, 150, 200]);
  expect(niceTicks(1_200_000)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
});
