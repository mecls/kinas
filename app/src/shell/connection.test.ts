import { describe, expect, test } from "bun:test";
import type { PlaceStatus, ReaderView } from "../api.ts";
import { readingState } from "@kinas/store/staleness";
import { asOf, lisbonClock } from "../usage/format.ts";
import { connectionOf, machineOf } from "./connection.ts";

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

  test("a reading stamped in what is now the future is stale, as the Usage page's Hostinger section says it", () => {
    // Taken just before the clock stepped back two hours: its age is unknown (packages/store/src/staleness.ts).
    const ahead = now + 2 * 60 * 60_000;
    expect(connectionOf({ now, readers: [reader({ last_success_at: ahead })] })).toEqual({ name: "Hostinger VPS", state: "stale", detail: asOf(ahead, now) });
    expect(readingState({ updatedAt: ahead, staleAfterMs: 300_000, deadAfterMs: 900_000, now })).toBe("stale");
    // At exactly now it is fresh: connected.
    expect(connectionOf({ now, readers: [reader({ last_success_at: now })] })?.state).toBe("connected");
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

describe("the VPS row while the usage snapshot cannot be read (ADR 0004)", () => {
  test("a connected row is stale: the last snapshot's age can no longer be judged, and the hover says why", () => {
    const row = connectionOf({ now, readers: [reader({})] }, "database is locked");
    expect(row).toEqual({ name: "Hostinger VPS", state: "stale", detail: `${asOf(now - 60_000, now)} · Could not read the readings: database is locked · showing the last reading` });
  });

  test("an error or a stale row keeps its word, and says the read failed too", () => {
    expect(connectionOf({ now, readers: [reader({ state: "error", last_error: "api token rejected" })] }, "database is locked")).toEqual({
      name: "Hostinger VPS",
      state: "error",
      detail: "api token rejected · Could not read the readings: database is locked · showing the last reading",
    });
    expect(connectionOf({ now, readers: [reader({ last_success_at: now - 300_001 })] }, "database is locked")?.state).toBe("stale");
  });

  test("no machine watched in the last snapshot is still no row; no failure changes nothing", () => {
    expect(connectionOf({ now, readers: [reader({ state: "not_configured" })] }, "database is locked")).toBeNull();
    expect(connectionOf({ now, readers: [reader({})] }, null)).toEqual(connectionOf({ now, readers: [reader({})] }));
  });
});

describe("one usage poller (build spec §11.1)", () => {
  test("the status bar draws the VPS from App's one usage snapshot and never reads the snapshot itself", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    // The interface polish (rule 22): the VPS left the sidebar for the status bar.
    const model = readFileSync(join(import.meta.dir, "statusBar.ts"), "utf8");
    const bar = readFileSync(join(import.meta.dir, "..", "ui", "StatusBar.tsx"), "utf8");
    const sidebar = readFileSync(join(import.meta.dir, "Sidebar.tsx"), "utf8");
    for (const source of [model, bar, sidebar]) {
      expect(source.includes("getUsageSnapshot")).toBe(false);
      expect(source.includes("onReadingsChanged")).toBe(false);
    }
    // Positive control: the model judges the VPS with this file's connectionOf, from the snapshot it is handed.
    expect(model.includes("connectionOf(snapshot")).toBe(true);
    expect(sidebar.includes("ConnectionRow")).toBe(false);
  });
});

describe("the agents' machine on the bar (DESIGN.md 1.14; build spec §4, Journey C)", () => {
  const status = (over: Partial<PlaceStatus>): PlaceStatus => ({ label: "vps-1", state: "connected", since: null, last_success_at: now - 15_000, problem: null, ...over });
  const at = (ms: number) => lisbonClock(ms, now);

  test("no VPS set is no part", () => {
    expect(machineOf(null, now)).toBeNull();
  });

  test("each of the four states has its word, and the hover says when", () => {
    expect(machineOf(status({}), now)).toEqual({ name: "vps-1", state: "connected", word: "connected", detail: `vps-1 · connected · last reading ${at(now - 15_000)}`, since: null, failing: false });
    expect(machineOf(status({ state: "reconnecting", since: now - 10_000, problem: "can't reach vps-1: timed out" }), now)?.detail).toBe(
      `vps-1 · reconnecting · last reading ${at(now - 15_000)} · can't reach vps-1: timed out`,
    );
    const down = machineOf(status({ state: "unreachable", since: now - 120_000, last_success_at: now - 135_000, problem: "can't reach vps-1: not reachable" }), now);
    expect(down?.word).toBe("unreachable");
    expect(down?.detail).toBe(`vps-1 · unreachable since ${at(now - 120_000)} · last reading ${at(now - 135_000)} · can't reach vps-1: not reachable`);
    const stopped = machineOf(status({ state: "not_running" }), now);
    expect(stopped?.word).toBe("Kinas on the Linux machine is not running");
    expect(stopped?.detail).toBe(`vps-1 · reached, but its reading loop has stopped · last reading ${at(now - 15_000)}`);
    expect(machineOf(status({ state: "reconnecting", last_success_at: null }), now)?.detail).toBe("vps-1 · reconnecting · no reading yet");
  });
});
