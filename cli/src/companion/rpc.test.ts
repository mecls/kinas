import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cloud } from "./cloud.ts";
import type { Firstmate } from "./firstmate.ts";
import { companionPaths } from "./paths.ts";
import { fakeMachine, NO_FIRSTMATE } from "./fake-machine.ts";
import { rpc, versionIn } from "./rpc.ts";
import { CHECK_IDS } from "./setup.ts";

const FIXTURE = join(import.meta.dir, "..", "..", "..", "fixtures", "companion-bundle.synthetic.json");

function deps() {
  const m = fakeMachine();
  const paths = m.deps.paths;
  return {
    paths,
    version: "0.1.0",
    herdrVersion: async (): Promise<string | null> => "0.9.5",
    readNow: async () => {},
    now: () => 1_794_834_015_000,
    herdr: async () => ({ ok: false, stdout: "" }),
    setup: m.deps,
    fm: NO_FIRSTMATE,
    log: (_: string) => {},
  };
}

describe("kinas companion rpc (slice 1)", () => {
  test("the paths follow KINAS_COMPANION_ROOT, else the XDG folders under the home", () => {
    expect(companionPaths({ KINAS_COMPANION_ROOT: "/r" })).toEqual({
      state: "/r/state",
      home: "/r/firstmate",
      reading: "/r/state/reading.json",
      herdr: "/r/bin/herdr",
      projectRoots: ["/r/projects"],
      projectsNamed: false,
      projectsProblem: null,
      claude: "/r/bin/claude",
      bin: "/r/bin",
      units: "/r/systemd/user",
      systemctl: "/r/bin/systemctl",
      loginctl: "/r/bin/loginctl",
      gh: "/r/bin/gh",
      claudeHome: "/r/claude-home",
      osRelease: "/r/os-release",
      releases: "/r/releases",
      root: "/r",
      relayInstruction: "/r/share/first-mate-relay.md",
      wrapperDir: "/r/share/bin",
      realClaude: "/r/bin/claude",
      proc: "/r/proc",
      managedSettings: "/r/etc/claude-code/managed-settings.json",
      tmp: "/r/tmp",
      workers: "/r/state/workers",
    });
    expect(companionPaths({}, "/home/captain")).toEqual({
      state: "/home/captain/.local/state/kinas",
      home: "/home/captain/.local/share/kinas/firstmate",
      reading: "/home/captain/.local/state/kinas/reading.json",
      herdr: "/home/captain/.local/bin/herdr",
      projectRoots: ["/home/captain/projects"],
      projectsNamed: false,
      projectsProblem: null,
      claude: "claude",
      bin: "/home/captain/.local/bin",
      units: "/home/captain/.config/systemd/user",
      systemctl: "/usr/bin/systemctl",
      loginctl: "/usr/bin/loginctl",
      gh: "gh",
      claudeHome: "/home/captain/.claude",
      osRelease: "/etc/os-release",
      releases: null,
      root: null,
      relayInstruction: "/home/captain/.local/share/kinas/first-mate-relay.md",
      wrapperDir: "/home/captain/.local/share/kinas/bin",
      realClaude: "/home/captain/.local/bin/claude",
      proc: "/proc",
      managedSettings: "/etc/claude-code/managed-settings.json",
      tmp: "/tmp",
      workers: "/home/captain/.local/state/kinas/workers",
    });
  });

  test("hello answers its version and the machine's Herdr, or null for Herdr when there is none", async () => {
    const said = await rpc('{"verb":"hello"}\n', deps());
    expect(said.exit).toBe(0);
    expect(said.reply).toMatchObject({ v: 1, companion: { version: "0.1.0" }, herdr: { version: "0.9.5" }, folders: [], user: "captain" });
    // Slice 4: setup's rows ride along, every id once.
    expect((said.reply as { checks: { id: string }[] }).checks.map((c) => c.id)).toEqual([...CHECK_IDS]);
    const none = { ...deps(), herdrVersion: async () => null };
    expect((await rpc('{"verb":"hello"}', none)).reply).toMatchObject({ v: 1, companion: { version: "0.1.0" }, herdr: null });
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
    expect(reply).toEqual({ ...JSON.parse(readFileSync(FIXTURE, "utf8")), served_at: 1_794_834_015_000, ledger: null, answers: [] });
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

  test("install answers done or cannot with exit 0, as the actions do (slice 4)", async () => {
    const d = deps();
    expect(await rpc('{"verb":"install","item":"relay-rule"}', d)).toEqual({ reply: { v: 1, cannot: "no-firstmate" }, exit: 0 });
    expect(await rpc('{"verb":"install","item":"companion-service"}', d)).toEqual({ reply: { v: 1, done: true }, exit: 0 });
    expect((await rpc('{"verb":"install","item":"anything"}', d)).exit).toBe(2);
  });

  test("answer (slice 6): delivered through the door with exit 0, its outcome then in the bundle, never its words", async () => {
    const d = deps();
    mkdirSync(d.paths.state, { recursive: true });
    writeFileSync(d.paths.reading, JSON.stringify({ v: 1, at: 1_794_834_000_000, questions: [{ task: "t1-9c2e", key: "k-9c2e", hold: false, opened_at: 1_794_833_000_000 }] }));
    const stdin: string[] = [];
    const fm: Firstmate = {
      run: async (call) => {
        if (call.script === "fm-fleet-snapshot.sh") {
          const snap = { schema: "fm-fleet-snapshot.v1", backlog: { records: [] }, tasks: [{ id: "t1-9c2e", hints: { open_decisions: [{ key: "k-9c2e", verb: "needs-decision", summary: "s" }] } }] };
          return { exit: 0, timed_out: false, stdout: JSON.stringify(snap), stderr_first: null };
        }
        if (call.script === "fm-inbox.sh" && "stdin" in call) {
          stdin.push(call.stdin);
          return { exit: 0, timed_out: false, stdout: '{"schema":"fm-inbox-note.v1","outcome":"created"}', stderr_first: null };
        }
        throw new Error(call.script);
      },
    };
    const request = { verb: "answer", task: "t1-9c2e", key: "k-9c2e", words: "On t1-9c2e (k-9c2e): yes-words-4b1c", request_id: "m1", from: "mac" };
    const said = await rpc(JSON.stringify(request), { ...d, fm });
    expect(said).toEqual({ reply: { v: 1, outcome: "delivered", item: "t1-9c2e@k-9c2e@1794833000000", at: 1_794_834_015_000, woken: true, replay: false }, exit: 0 });
    expect(stdin).toEqual(["On t1-9c2e (k-9c2e): yes-words-4b1c"]);
    const bundle = (await rpc('{"verb":"bundle"}', { ...d, fm })).reply as { answers: { request_id: string; state: string }[] };
    expect(bundle.answers.map((a) => [a.request_id, a.state])).toEqual([["m1", "delivered"]]);
    expect(JSON.stringify(bundle)).not.toContain("yes-words");
    // Refused requests run nothing.
    expect((await rpc(JSON.stringify({ ...request, from: "phone" }), d)).exit).toBe(2);
  });
});

describe("the pairing verbs (slice 8.1)", () => {
  const cloudOf = (over: Partial<Cloud> = {}): Cloud & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      replaceReading: async () => {},
      heartbeat: async () => {},
      takeAnswers: async () => [],
      settleAnswer: async () => {},
      startPairing: async (h, at) => void calls.push(`pair ${h.length} ${at}`),
      phones: async () => [{ id: "k1", name: "Phone", pairedAt: 1, lastSeenAt: 2, push: false }],
      unpair: async (id) => void calls.push(`unpair ${id}`),
      testNotification: async () => void calls.push("test"),
      ...over,
    };
  };
  const depsWith = (cloud: Cloud | null, phoneUrl: string | null = null) => ({ ...deps(), cloud, phoneUrl, now: () => 5_000 });

  test("pair-start hands the Mac a code, a link when the page is known, and ten minutes", async () => {
    const cloud = cloudOf();
    const { reply, exit } = await rpc(JSON.stringify({ verb: "pair-start" }), depsWith(cloud, "https://kinas-phone.example.app"));
    expect(exit).toBe(0);
    const r = reply as { v: number; code: string; url: string; expires_at: number };
    expect(r.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(r.url).toBe(`https://kinas-phone.example.app/#pair=${r.code}`);
    expect(r.expires_at).toBe(5_000 + 600_000);
    expect(cloud.calls).toEqual([`pair 64 ${605_000}`]);
    expect(JSON.stringify(cloud.calls)).not.toContain(r.code);
  });

  test("without a cloud the verbs say so, and a cloud that fails is a word, never its words", async () => {
    for (const request of [{ verb: "pair-start" }, { verb: "phones" }, { verb: "unpair", id: "k1" }]) {
      expect((await rpc(JSON.stringify(request), depsWith(null))).reply).toEqual({ v: 1, error: "no-cloud" });
    }
    const down = cloudOf({ startPairing: async () => { throw new Error("https://private.convex.cloud SECRET"); }, phones: async () => { throw new Error("SECRET"); } });
    for (const request of [{ verb: "pair-start" }, { verb: "phones" }, { verb: "unpair", id: "k1" }]) {
      const text = JSON.stringify((await rpc(JSON.stringify(request), depsWith(down))).reply);
      expect(text).toContain("cloud-failed");
      expect(text).not.toContain("SECRET");
    }
  });

  test("a test notification asks the store to push to every phone, once", async () => {
    const cloud = cloudOf();
    expect((await rpc(JSON.stringify({ verb: "test-notification" }), depsWith(cloud))).reply).toEqual({ v: 1, sent: true });
    expect(cloud.calls).toEqual(["test"]);
    expect((await rpc(JSON.stringify({ verb: "test-notification" }), depsWith(null))).reply).toEqual({ v: 1, error: "no-cloud" });
    const down = cloudOf({ testNotification: async () => { throw new Error("SECRET"); } });
    expect(JSON.stringify((await rpc(JSON.stringify({ verb: "test-notification" }), depsWith(down))).reply)).toBe('{"v":1,"error":"cloud-failed"}');
  });

  test("phones lists names and times; unpair removes one and answers with what is left", async () => {
    const cloud = cloudOf();
    expect((await rpc(JSON.stringify({ verb: "phones" }), depsWith(cloud))).reply).toEqual({ v: 1, phones: [{ id: "k1", name: "Phone", paired_at: 1, last_seen_at: 2, push: false }] });
    const out = await rpc(JSON.stringify({ verb: "unpair", id: "k1" }), depsWith(cloud));
    expect(cloud.calls).toEqual(["unpair k1"]);
    expect((out.reply as { phones: unknown[] }).phones).toHaveLength(1);
  });
});
