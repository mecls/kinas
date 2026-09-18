import { describe, expect, test } from "bun:test";
import type { ProviderMetricView } from "../api.ts";
import { BILLING_WINDOW, bytes, duration, forWindow, GAUGED, metricLabel, metricValue, ofLimit, TILE, windowLabel } from "./hostinger.ts";

const row = (metric: string, window: string, used: number, unit: string | null, limit: number | null = null): ProviderMetricView => ({
  provider: "hostinger",
  metric,
  window,
  used,
  limit_value: limit,
  unit,
  used_pct: null,
  left_pct: null,
  detail: "srv17923.hstgr.cloud · KVM 4 · running",
  source: "developers.hostinger.com/api/vps/v1/virtual-machines",
  updated_at: 1,
  state: "fresh",
});

describe("what is a gauge and what is the state of a running machine", () => {
  test("only bandwidth can ever be a gauge", () => {
    // CPU, RAM and disk all have denominators from the API, but they are live readings, not quotas. A bar on
    // one reads as an allowance being consumed, which is the wrong story about a running server (R11).
    expect([...GAUGED]).toEqual(["bandwidth"]);
    for (const live of ["cpu", "ram", "disk", "uptime"]) expect(GAUGED).not.toContain(live);
    expect([...TILE]).toEqual(["cpu", "ram", "disk", "uptime"]);
  });

  test("an unknown metric reads oddly rather than crashing", () => {
    expect(metricLabel("ram")).toBe("RAM");
    expect(metricLabel("gpuMinutes")).toBe("gpuMinutes");
  });
});

describe("units are the API's, and binary throughout", () => {
  test("bytes are shown in 1024-based units, because the allowances are MiB", () => {
    // Decimal GB beside a binary denominator would not add up on screen: 8192 MiB is "8.0 GiB", not "8.6 GB".
    expect(bytes(8192 * 1024 * 1024)).toBe("8.0 GiB");
    expect(bytes(4 * 1024 ** 4)).toBe("4.00 TiB");
    expect(bytes(2 * 1024 * 1024)).toBe("2 MiB");
    expect(bytes(512)).toBe("512 B");
  });

  test("the memory figure from the fixture reads as MiB, not as GB", () => {
    // 554 176 512 B is 528.5 MiB — under a GiB, so it must not round up into one.
    expect(bytes(554176512)).toBe("529 MiB");
  });

  test("each unit is formatted as what it is", () => {
    expect(metricValue(12.5, "%")).toBe("13%");
    expect(metricValue(554176512, "bytes")).toBe("529 MiB");
    expect(metricValue(1210200000, "ms")).toBe("14 d 0 h");
    expect(metricValue(3, null)).toBe("3");
  });

  test("uptime is days and hours, and under a day it is hours and minutes", () => {
    expect(duration(14 * 86_400_000 + 3 * 3_600_000)).toBe("14 d 3 h");
    expect(duration(5 * 3_600_000 + 30 * 60_000)).toBe("5 h 30 m");
    expect(duration(90_000)).toBe("1 m");
  });

  test("a denominator is shown in the same unit as the value", () => {
    expect(ofLimit(row("ram", "now", 554176512, "bytes", 8192 * 1024 * 1024))).toBe("of 8.0 GiB");
    // No denominator, no second line — which is how bandwidth renders until §7 Q1 is settled.
    expect(ofLimit(row("bandwidth", "month", 4 * 1024 ** 4, "bytes"))).toBeNull();
  });
});

describe("labels", () => {
  test("the month label never claims to be the billing period, because it may not be", () => {
    expect(windowLabel("month")).toBe("calendar month to date (UTC)");
    expect(windowLabel("month")).not.toContain("billing");
    expect(windowLabel("now")).toBe("now");
    // And the reason is on screen, not only in a comment.
    expect(BILLING_WINDOW).toContain("does not report when the monthly allowance resets");
  });
});

describe("selecting a window's rows", () => {
  test("keeps the page's order and ignores other providers and windows", () => {
    const metrics = [
      row("disk", "now", 1, "bytes"),
      { ...row("cpu", "now", 2, "%"), provider: "convex" as unknown as "hostinger" },
      row("cpu", "now", 3, "%"),
      row("bandwidth", "month", 4, "bytes"),
    ];
    const rows = forWindow(metrics, "now", TILE);
    expect(rows.map((r) => r.metric)).toEqual(["cpu", "disk"]);
    expect(rows.every((r) => r.provider === "hostinger" && r.window === "now")).toBe(true);
    // The month row belongs to the gauge, not the tile.
    expect(forWindow(metrics, "month", GAUGED).map((r) => r.metric)).toEqual(["bandwidth"]);
  });
});
