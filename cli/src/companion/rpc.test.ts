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
  return { paths, version: "0.1.0", herdrVersion: async (): Promise<string | null> => "0.9.5", readNow: async () => {}, now: () => 1_794_834_015_000, herdr: async () => ({ ok: false, stdout: "" }) };
}

describe("kinas companion rpc (slice 1)", () => {
  test("the paths follow KINAS_COMPANION_ROOT, else the XDG folders under the home", () => {
    expect(companionPaths({ KINAS_COMPANION_ROOT: "/r" })).toEqual({
      state: "/r/state",
      home: "/r/firstmate",
      reading: "/r/state/reading.json",
      herdr: "/r/bin/herdr",
      projects: "/r/projects",
      claude: "/r/bin/claude",
    });
    expect(companionPaths({}, "/home/captain")).toEqual({
      state: "/home/captain/.local/state/kinas",
      home: "/home/captain/.local/share/kinas/firstmate",
      reading: "/home/captain/.local/state/kinas/reading.json",
      herdr: "/home/captain/.local/bin/herdr",
      projects: "/home/captain/projects",
      claude: "claude",
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

  test("bundle hands back the latest reading verbatim, with no ledger while there is no ledger file", async () => {
    const d = deps();
    mkdirSync(d.paths.state, { recursive: true });
    writeFileSync(d.paths.reading, readFileSync(FIXTURE, "utf8"));
    const { reply, exit } = await rpc('{"verb":"bundle","cursor":null}', d);
    expect(exit).toBe(0);
    expect(reply).toEqual({ ...JSON.parse(readFileSync(FIXTURE, "utf8")), served_at: 1_794_834_015_000, ledger: null });
  });

  test("bundle with a cursor returns only the newer complete ledger lines; another file or a shorter one starts at 0", async () => {
    const d = deps();
    mkdirSync(d.paths.state, { recursive: true });
    writeFileSync(d.paths.reading, readFileSync(FIXTURE, "utf8"));
    mkdirSync(join(d.paths.home, "state"), { recursive: true });
    const ledger = join(d.paths.home, "state", "fleet-ledger.jsonl");
    writeFileSync(ledger, '{"a":1}\n{"b":2}\n{"c":');
    const first = (await rpc('{"verb":"bundle","cursor":null}', d)).reply as { ledger: { epoch: string; from: number; to: number; text: string } };
    expect(first.ledger).toMatchObject({ from: 0, to: 16, text: '{"a":1}\n{"b":2}\n' });
    const cursor = { epoch: first.ledger.epoch, offset: first.ledger.to, events: 0 };
    writeFileSync(ledger, '{"a":1}\n{"b":2}\n{"c":3}\n');
    const next = (await rpc(JSON.stringify({ verb: "bundle", cursor }), d)).reply as { ledger: { from: number; to: number; text: string } };
    expect(next.ledger).toMatchObject({ from: 16, to: 24, text: '{"c":3}\n' });
    const other = (await rpc(JSON.stringify({ verb: "bundle", cursor: { ...cursor, epoch: "1:2" } }), d)).reply as { ledger: { from: number } };
    expect(other.ledger.from).toBe(0);
    writeFileSync(ledger, '{"a":1}\n');
    const shorter = (await rpc(JSON.stringify({ verb: "bundle", cursor: { ...cursor, offset: 24 } }), d)).reply as { ledger: { from: number; text: string } };
    expect(shorter.ledger).toMatchObject({ from: 0, text: '{"a":1}\n' });
  });

  test("refresh runs a reading now, and says so when it failed", async () => {
    let reads = 0;
    expect(await rpc('{"verb":"refresh"}', { ...deps(), readNow: async () => void reads++ })).toEqual({ reply: { v: 1, refreshed: true }, exit: 0 });
    expect(reads).toBe(1);
    const broken = { ...deps(), readNow: async () => Promise.reject(new Error("x")) };
    expect(await rpc('{"verb":"refresh"}', broken)).toEqual({ reply: { v: 1, error: "reading-failed" }, exit: 1 });
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
