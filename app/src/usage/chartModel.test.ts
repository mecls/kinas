import { describe, expect, test } from "bun:test";
import type { UsageDay } from "../api.ts";
import { AXIS_LABEL_W, axisLabelDays, buildChart, CHART_MIN_DAYS, chartDays, niceTicks, periodRows, providerLabel, providerSlot } from "./chartModel.ts";

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
  test("one series per provider, stacked per day; each day keeps its models for the tooltip; cache reads only when asked", () => {
    const usage = [row("2026-09-13", "opus", 100, 50, 1000), row("2026-09-13", "glm", 10, 5, 0, "pi"), row("2026-09-14", "opus", 1, 1)];
    const off = buildChart({ usage, days, first_usage_date: "2026-09-13" }, false);
    expect(off.series.map((s) => [s.key, s.label])).toEqual([
      ["anthropic", "Anthropic"],
      ["ollama", "Ollama"],
    ]);
    expect(off.days[1]).toEqual({
      date: "2026-09-13",
      noData: false,
      total: 165,
      segments: [
        { key: "anthropic", value: 150 },
        { key: "ollama", value: 15 },
      ],
      models: [
        { key: "claude-code · opus", value: 150 },
        { key: "pi · glm", value: 15 },
      ],
    });
    const on = buildChart({ usage, days, first_usage_date: "2026-09-13" }, true);
    expect(on.days[1]!.total).toBe(1165);
    expect(on.series.map((s) => s.slot)).toEqual(off.series.map((s) => s.slot));
  });

  test("a provider's colour is its category, never its rank: the same slot whatever else is charted", () => {
    const both = buildChart({ usage: [row("2026-09-14", "opus", 1, 1), row("2026-09-14", "glm", 500, 0, 0, "pi")], days, first_usage_date: "2026-09-12" }, false);
    const alone = buildChart({ usage: [row("2026-09-14", "glm", 1, 0, 0, "pi")], days, first_usage_date: "2026-09-12" }, false);
    expect(alone.series[0]!.slot).toBe(both.series.find((s) => s.key === "ollama")!.slot);
    expect(both.series[0]!.slot).not.toBe(both.series[1]!.slot);
    expect(providerSlot("ollama", ["anthropic", "ollama"])).toBe(both.series.find((s) => s.key === "ollama")!.slot);
  });

  test("days before the first reading are no-data, never zero", () => {
    const model = buildChart({ usage: [row("2026-09-14", "opus", 1, 1)], days, first_usage_date: "2026-09-13" }, false);
    expect(model.days.map((d) => d.noData)).toEqual([true, false, false]);
    const empty = buildChart({ usage: [], days, first_usage_date: null }, false);
    expect(empty.days.every((d) => d.noData)).toBe(true);
    expect(empty.ticks).toEqual([0]);
  });
});

describe("periodRows", () => {
  test("today and month to date, per harness · model, busiest first, with every token kind and the messages", () => {
    const usage = [
      row("2026-08-31", "opus", 9_000, 9_000),
      row("2026-09-13", "opus", 100, 50, 1000),
      row("2026-09-14", "opus", 1, 1),
      row("2026-09-14", "glm", 10, 5, 0, "pi"),
    ];
    const snapshot = { usage, days: ["2026-08-31", ...days] };
    expect(periodRows(snapshot, "today")).toEqual([
      { key: "pi · glm", tokens_in: 10, tokens_cache_read: 0, tokens_out: 5, messages: 1 },
      { key: "claude-code · opus", tokens_in: 1, tokens_cache_read: 0, tokens_out: 1, messages: 1 },
    ]);
    // The month is the calendar month of the last charted day: August's row is not in it.
    expect(periodRows(snapshot, "month")).toEqual([
      { key: "claude-code · opus", tokens_in: 101, tokens_cache_read: 1000, tokens_out: 51, messages: 2 },
      { key: "pi · glm", tokens_in: 10, tokens_cache_read: 0, tokens_out: 5, messages: 1 },
    ]);
    expect(periodRows({ usage: [], days: [] }, "today")).toEqual([]);
  });
});

test("niceTicks", () => {
  expect(niceTicks(0)).toEqual([0]);
  // Tokens are whole numbers, so a step is never under 1: a day with 1 or 2 tokens gets distinct ticks, not the same
  // value twice (which the chart would draw twice and key twice).
  expect(niceTicks(1)).toEqual([0, 1]);
  expect(niceTicks(2)).toEqual([0, 1, 2]);
  expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  for (const max of [1, 2, 3, 4, 6, 7, 11, 13]) expect(new Set(niceTicks(max)).size, `ticks for ${max}`).toBe(niceTicks(max).length);
  expect(niceTicks(9)).toEqual([0, 5, 10]);
  expect(niceTicks(165)).toEqual([0, 50, 100, 150, 200]);
  expect(niceTicks(1_200_000)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
});

describe("axisLabelDays", () => {
  const plotW = (card: number) => card - 48 - 8; // the chart's PAD.left and PAD.right
  const overlaps = (labels: number[], slotW: number) => labels.some((d, i) => i > 0 && (d - labels[i - 1]!) * slotW < AXIS_LABEL_W);

  test("a full-width chart names every seventh day and the last, as it always has", () => {
    // 720 px: 30 days of 22 px. Day 29 is one past a weekly label (28), too close to name.
    expect(axisLabelDays(30, plotW(720) / 30)).toEqual([0, 7, 14, 21, 28]);
    // 31 days: the last is two past day 28, still under three days.
    expect(axisLabelDays(31, plotW(720) / 31)).toEqual([0, 7, 14, 21, 28]);
    // 34 days: the last is five past day 28, so it is named.
    expect(axisLabelDays(34, plotW(720) / 34)).toEqual([0, 7, 14, 21, 28, 33]);
  });

  test("a narrow chart spaces its labels by two or four weeks, and no two ever overlap", () => {
    for (const card of [120, 160, 200, 260, 320, 420, 560, 720, 1000]) {
      const slotW = plotW(card) / 30;
      const labels = axisLabelDays(30, slotW);
      expect(`${card}: ${overlaps(labels, slotW) ? "overlap" : "clear"}`).toBe(`${card}: clear`);
      expect(labels[0]).toBe(0);
    }
    expect(axisLabelDays(30, plotW(200) / 30)).toEqual([0, 14, 28]);
    expect(axisLabelDays(30, plotW(120) / 30)).toEqual([0, 28]);
  });
});

describe("a provider's name is the transcript's word", () => {
  test("a Pi provider named after an Object member reads as itself, never as the prototype's member", () => {
    // Pi writes `message.provider` from its own config, and Rust stores it as written (readers/logs.rs). `__proto__`
    // came back as Object.prototype — an object in the legend, which React refuses, and every page with it.
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(providerLabel(name)).toBe(name);
    const usage = [{ ...row("2026-09-13", "m", 1, 1, 0, "pi"), provider: "__proto__" }];
    expect(buildChart({ usage, days, first_usage_date: "2026-09-12" }, false).series.map((s) => s.label)).toEqual(["__proto__"]);
    // Positive control: a known provider still reads in its own words.
    expect(providerLabel("anthropic")).toBe("Anthropic");
  });
});

describe("the chart spans the data (the interface polish, rule 30)", () => {
  /** The 30 days of today, oldest first, ending on 2026-11-17. */
  const thirty = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 17 - 29 + i)).toISOString().slice(0, 10));

  test("trims to the data: first data 3 days ago draws 7 days, 3 of them hatched", () => {
    const first = thirty[26]!; // 2026-11-14, three days before today
    const model = buildChart({ usage: [row(first, "opus", 1, 1)], days: thirty, first_usage_date: first }, false);
    expect(model.days).toHaveLength(CHART_MIN_DAYS);
    expect(model.days[0]!.date).toBe("2026-11-11");
    expect(model.days.filter((d) => d.noData)).toHaveLength(3);
  });

  test("first data 20 days ago draws 21 days, none hatched; 40 days ago draws all 30", () => {
    expect(chartDays(thirty, thirty[9]!)).toHaveLength(21);
    expect(buildChart({ usage: [], days: thirty, first_usage_date: thirty[9]! }, false).days.some((d) => d.noData)).toBe(false);
    expect(chartDays(thirty, "2026-10-08")).toEqual(thirty);
  });

  test("no data ever draws the last week, hatched; data from today alone is still a week", () => {
    expect(chartDays(thirty, null)).toEqual(thirty.slice(-CHART_MIN_DAYS));
    expect(chartDays(thirty, thirty[29]!)).toHaveLength(CHART_MIN_DAYS);
    expect(chartDays(["2026-11-16", "2026-11-17"], null)).toEqual(["2026-11-16", "2026-11-17"]);
  });
});
