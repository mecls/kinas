import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companionPaths } from "./paths.ts";
import { rpc, versionIn } from "./rpc.ts";

const FIXTURE = join(import.meta.dir, "..", "..", "..", "fixtures", "companion-bundle.synthetic.json");

function deps() {
  const root = mkdtempSync(join(tmpdir(), "kinas-companion-"));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  return { paths, version: "0.1.0", herdrVersion: async (): Promise<string | null> => "0.9.5" };
}

describe("kinas companion rpc (slice 1)", () => {
  test("the paths follow KINAS_COMPANION_ROOT, else the XDG folders under the home", () => {
    expect(companionPaths({ KINAS_COMPANION_ROOT: "/r" })).toEqual({
      state: "/r/state",
      home: "/r/firstmate",
      reading: "/r/state/reading.json",
      herdr: "/r/bin/herdr",
    });
    expect(companionPaths({}, "/home/captain")).toEqual({
      state: "/home/captain/.local/state/kinas",
      home: "/home/captain/.local/share/kinas/firstmate",
      reading: "/home/captain/.local/state/kinas/reading.json",
      herdr: "/home/captain/.local/bin/herdr",
    });
  });

  test("hello answers its version and the machine's Herdr, or null for Herdr when there is none", async () => {
    expect(await rpc('{"verb":"hello"}\n', deps())).toEqual({ reply: { v: 1, companion: { version: "0.1.0" }, herdr: { version: "0.9.5" } }, exit: 0 });
    const none = { ...deps(), herdrVersion: async () => null };
    expect(await rpc('{"verb":"hello"}', none)).toEqual({ reply: { v: 1, companion: { version: "0.1.0" }, herdr: null }, exit: 0 });
  });

  test("a version is the first x.y.z in what the tool printed", () => {
    expect(versionIn("herdr 0.9.5\n")).toBe("0.9.5");
    expect(versionIn("no-mistakes version v1.79.0 (fc540ac)")).toBe("1.79.0");
    expect(versionIn("build 10.0.1.2")).toBe("10.0.1");
    expect(versionIn("herdr dev")).toBeNull();
  });

  test("bundle hands back the latest reading verbatim", async () => {
    const d = deps();
    mkdirSync(d.paths.state, { recursive: true });
    writeFileSync(d.paths.reading, readFileSync(FIXTURE, "utf8"));
    const { reply, exit } = await rpc('{"verb":"bundle","cursor":null}', d);
    expect(exit).toBe(0);
    expect(reply).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  test("bundle with no reading, or one of another version, fails without guessing", async () => {
    const d = deps();
    expect(await rpc('{"verb":"bundle"}', d)).toEqual({ reply: { v: 1, error: "no-reading" }, exit: 1 });
    mkdirSync(d.paths.state, { recursive: true });
    writeFileSync(d.paths.reading, '{"v":2}');
    expect(await rpc('{"verb":"bundle"}', d)).toEqual({ reply: { v: 1, error: "bad-reading" }, exit: 1 });
    writeFileSync(d.paths.reading, "{");
    expect(await rpc('{"verb":"bundle"}', d)).toEqual({ reply: { v: 1, error: "bad-reading" }, exit: 1 });
  });

  test("anything not a request is refused with exit 2 and runs nothing", async () => {
    expect((await rpc("not json", deps())).exit).toBe(2);
    expect((await rpc('{"verb":"install","item":"x"}', deps())).exit).toBe(2);
    expect((await rpc("x".repeat(70_000), deps())).reply).toEqual({ v: 1, error: "refused", why: "the request is too large" });
  });
});
