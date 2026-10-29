import { describe, expect, test } from "bun:test";
import type { ReaderView } from "../api.ts";
import { asOf } from "../usage/format.ts";
import { connectionOf } from "./connection.ts";

const now = 1_800_000_000_000;
const reader = (over: Partial<ReaderView>): ReaderView => ({
  reader: "hostinger",
  state: "ok",
  last_attempt_at: now,
  last_success_at: now - 60_000,
  last_error: null,
  stale_after_ms: 300_000,
  dead_after_ms: 900_000,
  ...over,
});

describe("the VPS row's word (DESIGN.md §3.1)", () => {
  test("no Hostinger reader, or one not configured, is no row", () => {
    expect(connectionOf({ now, readers: [] })).toBeNull();
    expect(connectionOf({ now, readers: [reader({ state: "not_configured" })] })).toBeNull();
  });

  test("a fresh reading is connected; one past stale_after is stale; a failure is error, in the reader's words", () => {
    expect(connectionOf({ now, readers: [reader({})] })?.state).toBe("connected");
    expect(connectionOf({ now, readers: [reader({ last_success_at: now - 300_001 })] })?.state).toBe("stale");
    expect(connectionOf({ now, readers: [reader({ last_success_at: null })] })).toMatchObject({ state: "stale", detail: "no reading yet" });
    expect(connectionOf({ now, readers: [reader({ state: "error", last_error: "api token rejected" })] })).toEqual({ name: "Hostinger VPS", state: "error", detail: "api token rejected" });
  });

  test("the hover's 'as of' is the Usage page's own caption for the same reading: 24-hour, Europe/Lisbon, never the locale's", () => {
    // 1_800_000_000_000 ms is 2027-01-15 08:00 UTC, 08:00 in Lisbon in January; a minute earlier is 07:59.
    const connected = connectionOf({ now, readers: [reader({})] });
    expect(connected?.detail).toBe(asOf(now - 60_000, now));
    expect(connected?.detail).toBe("as of 07:59");
    const stale = connectionOf({ now, readers: [reader({ last_success_at: now - 300_001 })] });
    expect(stale?.detail).toBe(asOf(now - 300_001, now));
    expect(stale?.detail).toMatch(/^as of \d\d:\d\d$/);
  });
});

describe("one usage poller (build spec §11.1)", () => {
  test("the sidebar draws the VPS row from App's one usage snapshot and never reads the snapshot itself", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const sidebar = readFileSync(join(import.meta.dir, "Sidebar.tsx"), "utf8");
    expect(sidebar.includes("getUsageSnapshot")).toBe(false);
    expect(sidebar.includes("onReadingsChanged")).toBe(false);
    // Positive control: the row is still drawn there, from a prop.
    expect(sidebar.includes("ConnectionRow")).toBe(true);
    expect(sidebar.includes("connection")).toBe(true);
  });
});
