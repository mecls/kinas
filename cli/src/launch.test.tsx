import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BANNER, logoLines, visibleWidth } from "@kinas/commands/theme";
import { computePacket, loadConfig, type Packet } from "@kinas/context";
import { makeWorld, type World } from "@kinas/context/testing";
import { renderLaunch, shortNote } from "./launch.tsx";
import { selfCommand } from "./background.ts";

const CRIMSON = "38;2;196;38;46m";
let world: World;
let packet: Packet;

beforeAll(async () => {
  world = await makeWorld();
  packet = await computePacket(loadConfig(world.env), null);
});
afterAll(() => world.cleanup());

const lines = (s: string) => s.replace(/\n$/, "").split("\n");

describe("the launch screen", () => {
  test("at 100 columns: banner intact, every section, no line wider than the screen", () => {
    const out = renderLaunch(packet, { columns: 100, color: false, now: world.now });
    for (const row of BANNER) expect(out).toContain(row);
    for (const heading of ["Kinas", "Projects", "Crew", "Sessions", "Decisions", "Quotas", "Recent"]) expect(out).toContain(`│ ${heading}`);
    for (const l of lines(out)) expect(visibleWidth(l)).toBeLessThanOrEqual(100);
    expect(out).toContain("Acme Ops · operations");
    expect(out).toContain("Pick a payments provider");
    expect(lines(out).at(-1)).toBe(" 2 projects · 2 sessions · 1 decision waiting on you · kinas --help for commands");
  });

  test("the logo sits beside the banner, and gives way to it below 64 columns", () => {
    const wide = renderLaunch(packet, { columns: 100, color: false, now: world.now });
    for (const row of logoLines(false)) expect(wide).toContain(row);
    const bannerTop = lines(wide).find((l) => l.includes(BANNER[0]!))!;
    expect(logoLines(false).some((row) => bannerTop.includes(row))).toBe(true);

    expect(renderLaunch(packet, { columns: 64, color: false, now: world.now })).toContain(logoLines(false)[5]!);
    const tight = renderLaunch(packet, { columns: 60, color: false, now: world.now });
    expect(tight).not.toContain(logoLines(false)[5]!);
    for (const row of BANNER) expect(tight).toContain(row);
    for (const l of lines(tight)) expect(visibleWidth(l)).toBeLessThanOrEqual(60);
  });

  test("never wider than 100 columns, and stacked when narrow", () => {
    for (const l of lines(renderLaunch(packet, { columns: 180, color: true, now: world.now }))) expect(visibleWidth(l)).toBeLessThanOrEqual(100);
    const narrow = renderLaunch(packet, { columns: 72, color: false, now: world.now });
    for (const l of lines(narrow)) expect(visibleWidth(l)).toBeLessThanOrEqual(72);
    expect(narrow.indexOf("│ Projects")).toBeGreaterThan(narrow.indexOf("│ Kinas"));
  });

  test("crimson is the accent line, plus the footer only when something needs a decision", () => {
    const count = (p: Packet) => renderLaunch(p, { columns: 100, color: true, now: world.now }).split(CRIMSON).length - 1;
    expect(count(packet)).toBe(2);
    expect(count({ ...packet, decisions: { ...packet.decisions, data: [] } })).toBe(1);
  });

  test("without colour there is no escape code at all", () => {
    expect(renderLaunch(packet, { columns: 100, color: false, now: world.now })).not.toContain("\x1b[");
  });

  test("a missing source is one short line on screen", () => {
    const out = renderLaunch({ ...packet, sessions: { state: "unavailable", note: "herdr: not running", at: world.now, data: null } }, { columns: 100, color: false, now: world.now });
    expect(out).toContain("│   herdr: not running");
    expect(lines(out).at(-1)).toContain("herdr not running");
    expect(shortNote("firstmate: not installed (no /x/bin/fm-fleet-snapshot.sh)")).toBe("firstmate: not installed");
  });
});

describe("the keyboard contract", () => {
  test("no CLI source reads keys: nothing captures Tab, nothing holds the terminal", () => {
    const dir = import.meta.dir;
    for (const f of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      expect([f, readFileSync(join(dir, f), "utf8")]).not.toEqual([f, expect.stringMatching(/setRawMode|useInput|usePaste|useFocus|readline/)]);
    }
  });

  test("the background refresh re-runs this CLI the way it was started", () => {
    expect(selfCommand(["/usr/bin/bun", "/src/cli/src/main.ts"], "/usr/bin/bun")).toEqual(["/usr/bin/bun", "/src/cli/src/main.ts"]);
    expect(selfCommand(["kinas", "/$bunfs/root/kinas-cli"], "/Applications/Kinas.app/Contents/MacOS/kinas-cli")).toEqual(["/Applications/Kinas.app/Contents/MacOS/kinas-cli"]);
  });
});
