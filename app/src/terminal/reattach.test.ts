import { describe, expect, test } from "bun:test";
import { REATTACH_MS, reattachDelay } from "./reattach.ts";

// Build spec §11.2, slice 3.1: Herdr's remote client that exits is started again by itself, never in a tight loop.
describe("attaching again", () => {
  test("a client that lasted waits 2 s; each quick exit in a row waits longer, up to 30 s", () => {
    expect(reattachDelay(0)).toBe(2_000);
    expect(reattachDelay(1)).toBe(2_000);
    expect(reattachDelay(2)).toBe(5_000);
    expect(reattachDelay(3)).toBe(10_000);
    expect(reattachDelay(4)).toBe(30_000);
    expect(reattachDelay(40)).toBe(30_000);
    expect(Math.max(...REATTACH_MS)).toBe(30_000);
  });
});
