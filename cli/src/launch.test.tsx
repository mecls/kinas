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

  test("a source's control characters, colour codes included, are shown on the screen and never obeyed", () => {
    // The screen folds every row through `flat`, which keeps `ESC [ … m` for the screen's own colours: a source's went
    // through with them, so a commit subject holding `ESC [ 8 m` concealed the rest of the screen, and `ESC ] 52` in a
    // task's title set the terminal's clipboard before `flat` showed it.
    const forged: Packet = {
      ...packet,
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9c2e", title: "Pick \x1b[30;40mblack", reason: "why \x1b]52;c;aGk=\x07" }] },
      recent: { ...packet.recent, data: [{ at: world.now, kind: "commit", project: "acme", text: "fix \x1b[8mhidden" }] },
    };
    const plain = renderLaunch(forged, { columns: 100, color: false, now: world.now });
    expect(plain).not.toContain("\x1b");
    expect(plain).toContain("fix \uFFFD[8mhidden");
    expect(plain).toContain("Pick \uFFFD[30;40mblack");
    const painted = renderLaunch(forged, { columns: 100, color: true, now: world.now });
    expect(painted).not.toMatch(/\x1b\[(?:30;40|8)m|\x1b\]/);
    expect(painted).toContain(CRIMSON);
  });

  test("crimson is the accent line, plus the footer only when something needs a decision", () => {
    const count = (p: Packet) => renderLaunch(p, { columns: 100, color: true, now: world.now }).split(CRIMSON).length - 1;
    expect(count(packet)).toBe(2);
    expect(count({ ...packet, decisions: { ...packet.decisions, data: [] } })).toBe(1);
  });

  test("no text colour is fixed for a dark ground: only blue, crimson and the logo are 24-bit", () => {
    const out = renderLaunch(packet, { columns: 100, color: true, now: world.now });
    // The old secondary grey and the old gold, as 24-bit: near-invisible on warm white.
    expect(out).not.toContain("133;147;166");
    expect(out).not.toContain("223;174;60");
    const exact = new Set([...out.matchAll(/38;2;(\d+;\d+;\d+)/g)].map((m) => m[1]));
    expect([...exact].sort()).toEqual(["0;84;158", "196;38;46", "244;242;236"]);
  });

  test("the logo's disc is navy unless the terminal says its ground is light, and then it is royal blue", () => {
    const dark = renderLaunch(packet, { columns: 100, color: true, now: world.now });
    expect(dark).toContain("48;2;10;20;32");
    expect(renderLaunch(packet, { columns: 100, color: true, polarity: "dark", now: world.now })).toBe(dark);
    const light = renderLaunch(packet, { columns: 100, color: true, polarity: "light", now: world.now });
    expect(light).toContain("48;2;0;84;158");
    expect(light).not.toContain("48;2;10;20;32");
    // Nothing but the logo depends on the ground: with the logo gone, the two screens are one.
    expect(renderLaunch(packet, { columns: 60, color: true, polarity: "light", now: world.now })).toBe(renderLaunch(packet, { columns: 60, color: true, now: world.now }));
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

  test("a newline in a title, a reason or an event text is one row of its panel, not a second row without its glyph", () => {
    const forged: Packet = {
      ...packet,
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9", title: "Pick a key\nnow", reason: "needs the captain\r\nsee the notes" }] },
      recent: { ...packet.recent, data: [{ at: world.now, kind: "crew", project: "acme", text: "held\nfor a key" }] },
    };
    const out = renderLaunch(forged, { columns: 100, color: false, now: world.now });
    expect(out).toContain("│   ▲ Pick a key now · needs the captain see the notes");
    expect(out).toContain("acme held for a key");
    // Every row is a bordered row of its panel, or the screen's own header and footer.
    for (const l of lines(out)) expect(l, l).toMatch(/^(│|╭|╰|[ ]|$)/);
    expect(out).not.toMatch(/^(now|see the notes|for a key)/m);
  });
});

describe("the keyboard contract", () => {
  test("hold.ts and confirm.ts are the only CLI sources that read keys", () => {
    // Amended 2026-09-24 (the first mate): `kinas crew setup` asks y/N through confirm.ts, a line at a time.
    const dir = import.meta.dir;
    const readers = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .filter((f) => /setRawMode|useInput|usePaste|useFocus|readline/.test(readFileSync(join(dir, f), "utf8")))
      .sort();
    expect(readers).toEqual(["confirm.ts", "hold.ts"]);
  });

  test("the background refresh re-runs this CLI the way it was started", () => {
    expect(selfCommand(["/usr/bin/bun", "/src/cli/src/main.ts"], "/usr/bin/bun")).toEqual(["/usr/bin/bun", "/src/cli/src/main.ts"]);
    expect(selfCommand(["kinas", "/$bunfs/root/kinas-cli"], "/Applications/Kinas.app/Contents/MacOS/kinas-cli")).toEqual(["/Applications/Kinas.app/Contents/MacOS/kinas-cli"]);
  });
});
