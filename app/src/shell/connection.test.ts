import { describe, expect, test } from "bun:test";
import type { ReaderView } from "../api.ts";
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
});
