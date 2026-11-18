import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companionPaths } from "./paths.ts";
import { rpc } from "./rpc.ts";

const FIXTURE = join(import.meta.dir, "..", "..", "..", "fixtures", "companion-bundle.synthetic.json");

function deps() {
  const root = mkdtempSync(join(tmpdir(), "kinas-companion-"));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  return { paths, version: "0.1.0" };
}

describe("kinas companion rpc (slice 1)", () => {
  test("the paths follow KINAS_COMPANION_ROOT, else the XDG folders under the home", () => {
    expect(companionPaths({ KINAS_COMPANION_ROOT: "/r" })).toEqual({ state: "/r/state", home: "/r/firstmate", reading: "/r/state/reading.json" });
    expect(companionPaths({}, "/home/captain")).toEqual({
      state: "/home/captain/.local/state/kinas",
      home: "/home/captain/.local/share/kinas/firstmate",
      reading: "/home/captain/.local/state/kinas/reading.json",
    });
  });

  test("hello answers its version", async () => {
    expect(await rpc('{"verb":"hello"}\n', deps())).toEqual({ reply: { v: 1, companion: { version: "0.1.0" } }, exit: 0 });
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
