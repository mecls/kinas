import { describe, expect, test } from "bun:test";
import type { PaneState } from "../api.ts";
import type { Machine } from "../shell/connection.ts";
import { lisbonClock } from "../usage/format.ts";
import { chromeSession, detachedOf } from "./workChrome.ts";

// DESIGN.md 1.14, 4 Terminal chrome; build spec §11.2, slice 3.1.

const now = 1_800_000_000_000;
const pane = (over: Partial<PaneState>): PaneState => ({ place: null, session: "default", workspace: "firstmate", word: null, profile: "claude", stale: false, ...over });
const machine = (over: Partial<Machine>): Machine => ({ name: "vps-1", state: "connected", word: "connected", detail: "", since: null, failing: false, ...over });

describe("the chrome's session line", () => {
  test("the place first on a VPS, then the session and the focused workspace", () => {
    expect(chromeSession(pane({ place: "vps-1", workspace: "shop" }))).toBe("vps-1 · default · shop");
    expect(chromeSession(pane({}))).toBe("default · firstmate");
    expect(chromeSession(pane({ workspace: null }))).toBe("default");
    expect(chromeSession(pane({ place: "vps-1", workspace: null }))).toBe("vps-1 · default");
    expect(chromeSession(null)).toBe("");
  });
});

describe("the detached badge", () => {
  test("never on this Mac, whatever the pane or a stale machine says", () => {
    for (const attach of ["connecting", "attached", "detached"] as const) expect(detachedOf(null, attach, machine({ state: "unreachable" }), now)).toBeNull();
  });

  test("connecting until the pane first draws; nothing once it has and the machine answers", () => {
    expect(detachedOf("vps-1", "connecting", machine({}), now)).toEqual({ state: "connecting", since: null });
    expect(detachedOf("vps-1", "connecting", null, now)).toEqual({ state: "connecting", since: null });
    expect(detachedOf("vps-1", "attached", machine({}), now)).toBeNull();
    expect(detachedOf("vps-1", "attached", machine({ state: "not_running" }), now)).toBeNull();
  });

  test("reconnecting when the client exited, or the door failed since it last worked — not before anything was tried", () => {
    expect(detachedOf("vps-1", "detached", machine({}), now)).toEqual({ state: "reconnecting", since: null });
    expect(detachedOf("vps-1", "attached", machine({ state: "reconnecting", failing: true }), now)).toEqual({ state: "reconnecting", since: null });
    expect(detachedOf("vps-1", "attached", machine({ state: "reconnecting", failing: false }), now)).toBeNull();
  });

  test("unreachable since the bar's own time, whatever the pane last did", () => {
    const since = now - 120_000;
    for (const attach of ["connecting", "attached", "detached"] as const) {
      expect(detachedOf("vps-1", attach, machine({ state: "unreachable", since, failing: true }), now)).toEqual({ state: "unreachable", since: lisbonClock(since, now) });
    }
    expect(detachedOf("vps-1", "detached", machine({ state: "unreachable" }), now)).toEqual({ state: "unreachable", since: null });
  });
});
