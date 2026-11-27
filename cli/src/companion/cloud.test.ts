import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPS as STORE_CAPS, conforms, summary as storeSummary } from "../../../cloud/convex/lib/summary.ts";
import { questionsOf } from "./answer.ts";
import { BOARD_CAP, CAPS, CloudError, HEARTBEAT_MS, RESEND_MS, clamp, convexCloud, fileCloud, fingerprint, freshTend, readCompanionEnv, summaryOf, tendCloud, type Cloud } from "./cloud.ts";
import type { Reading } from "./run.ts";

const fixtures = join(import.meta.dir, "..", "..", "..", "fixtures");
const snapshot = readFileSync(join(fixtures, "firstmate-fleet-snapshot.current.synthetic.json"), "utf8");
const AT = 1_790_000_000_000;

function reading(over: Partial<Reading> = {}, snap = snapshot): Reading {
  return {
    v: 1,
    at: AT,
    companion: { version: "0.1.0", since: AT - 60_000, heartbeat_at: AT },
    home: "/home/claude/.local/share/kinas/firstmate",
    installed: true,
    snapshot: { exit: 0, timed_out: false, stdout: snap, stderr_first: "" },
    capacity: null,
    capacity_at: null,
    afk: null,
    modes: {},
    origins: { shop: "https://github.com/miraside/shop.git" },
    herdr_view: null,
    herdr_foreground: null,
    prs: [],
    questions: questionsOf(snap, null, AT) ?? [],
    ...over,
  } as Reading;
}

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kinas-cloud-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("summary_allowlist: no path, branch, key, log or transcript reaches the summary", () => {
  const planted = JSON.parse(snapshot);
  planted.tasks[0].paths.worktree.path = "/home/claude/treehouse/secret-client/1";
  planted.tasks[0].branch = "fm/secret-client-branch";
  planted.tasks[0].current_state.detail = "sk-ant-api03-FAKEFAKEFAKE read ~/.claude/.credentials.json";
  planted.tasks[0].paths.status_log.last_event.raw = "done: pushed to origin/fm/secret-client-branch";
  const text = JSON.stringify(summaryOf(reading({ plan: null, usage: null, branches: [{ task: "x", checked_at: 1, out: { exit: 0, timed_out: false, stdout: "src/secret/file.ts\n", stderr_first: "" } }], origins: { shop: "git@github.com:secret/repo.git" } }, JSON.stringify(planted)), "homelab"));
  for (const leak of ["/home/claude", "treehouse", "secret-client", "fm/", "sk-ant", ".credentials", "origin/", "src/secret", "git@github.com", "__FM_HOME__"]) expect(text, leak).not.toContain(leak);
});

test("the summary is exactly the shape the store holds, and the store's caps are the companion's", () => {
  const s = summaryOf(reading(), "homelab");
  expect(conforms(storeSummary, s)).toBeNull();
  const shared = (Object.keys(CAPS) as (keyof typeof CAPS)[]).filter((k) => k in STORE_CAPS);
  expect(shared.length).toBe(Object.keys(CAPS).length);
  for (const k of shared) expect<number>(CAPS[k], k).toBe(STORE_CAPS[k as keyof typeof STORE_CAPS] as number);
});

test("the board and the waiting items come from the fleet: a held task is a question with its hold's words", () => {
  const s = summaryOf(reading(), "homelab");
  const held = s.waiting.find((w) => w.task === "stock-webhook-9c2e");
  expect(held).toBeDefined();
  expect(held!.key).toMatch(/^stock-webhook-9c2e@stock-webhook-9c2e@\d+$/);
  expect(held!.question).toContain("Land the stock webhook 9c2e?");
  expect(held!.title).toBe("Stock webhook 9c2e");
  expect(held!.project).toBe("shop-9c2e");
  expect(held!.recommendation).toBeNull();
  expect(s.counts.waiting).toBe(s.waiting.length);
  expect(s.label).toBe("homelab");
  expect(s.asOf).toBe(AT);
});

test("a task that is done is not on the board; one waiting on the captain says so", () => {
  const s = summaryOf(reading(), "homelab");
  expect(s.board.every((t) => t.word !== "done" && t.word !== "gone")).toBe(true);
  expect(s.board.some((t) => t.word === "needs decision")).toBe(true);
  const doneSnap = readFileSync(join(fixtures, "firstmate-fleet-snapshot.done.captured.json"), "utf8");
  const fleetDone = JSON.parse(doneSnap);
  const nDone = (fleetDone.backlog.records as { state: string }[]).filter((r) => r.state === "done").length;
  expect(nDone).toBeGreaterThan(0);
  const d = summaryOf(reading({}, doneSnap), "homelab");
  expect(d.board.length).toBeLessThan((fleetDone.backlog.records as unknown[]).length);
  expect(d.board.every((t) => t.word !== "done")).toBe(true);
});

test("a snapshot that isn't the fleet's contract gives an empty board, never a guess", () => {
  const s = summaryOf(reading({}, JSON.stringify({ schema: "fm-fleet-snapshot.v2" })), "homelab");
  expect(s.board).toEqual([]);
  expect(s.waiting).toEqual([]);
  const none = summaryOf(reading({ snapshot: null }), "homelab");
  expect(none.board).toEqual([]);
});

test("every string is clamped to its cap, and the board to its size", () => {
  const long = JSON.parse(snapshot);
  long.backlog.records[0].title = "t".repeat(500);
  long.backlog.records[0].hold_reason = "q".repeat(5_000);
  const s = summaryOf(reading({}, JSON.stringify(long)), "x".repeat(80));
  expect([...s.label].length).toBe(CAPS.label);
  for (const w of s.waiting) {
    expect([...w.title].length).toBeLessThanOrEqual(CAPS.title);
    expect([...w.question].length).toBeLessThanOrEqual(CAPS.question);
  }
  for (const t of s.board) expect([...t.title].length, t.task).toBeLessThanOrEqual(CAPS.title);
  expect(s.board.some((t) => [...t.title].length === CAPS.title)).toBe(true);
  expect(s.board.length).toBeLessThanOrEqual(BOARD_CAP);
  expect(clamp("abc", 3)).toBe("abc");
  expect(clamp("abcd", 3)).toBe("ab…");
  expect([...clamp("é".repeat(10), 4)].length).toBe(4);
});

test("usage and host come from the plan hand-off and the host reading, and are null or zero without them", () => {
  const plan = { text: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 57, resets_at: 1 }, seven_day: { used_percentage: 13, resets_at: 2 } } }), file_at: AT, last_assistant_at: AT };
  const host = { cpu_pct: 3.4, mem_used_gb: 4, mem_total_gb: 16, disk_used_gb: 50, disk_total_gb: 292, disk_available_gb: 242 };
  const s = summaryOf(reading({ plan, host }), "homelab");
  expect(s.usage).toEqual({ planWeekPct: 13, planSessionPct: 57 });
  expect(s.host).toEqual({ cpu: 3, memPct: 25, diskPct: 17 });
  const bare = summaryOf(reading(), "homelab");
  expect(bare.usage).toEqual({ planWeekPct: null, planSessionPct: null });
  expect(bare.host).toEqual({ cpu: 0, memPct: 0, diskPct: 0 });
});

test("a quiet factory has one fingerprint however the clock moves; a changed word changes it", () => {
  const a = summaryOf(reading(), "homelab");
  const later = summaryOf(reading({ at: AT + 15_000, companion: { version: "0.1.0", since: 1, heartbeat_at: AT + 15_000 } }), "homelab");
  expect(fingerprint(later)).toBe(fingerprint(a));
  const changed = { ...a, counts: { ...a.counts, working: a.counts.working + 1 } };
  expect(fingerprint(changed)).not.toBe(fingerprint(a));
});

test("fileCloud appends one line per write and hands out the answers planted beside it", async () => {
  const path = join(scratch(), "cloud.jsonl");
  const cloud = fileCloud(path);
  await cloud.heartbeat(1, "0.1.0", "homelab");
  await cloud.settleAnswer("r-1", "read", 5, "On it");
  await cloud.startPairing("a".repeat(64), 9);
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => l.op)).toEqual(["heartbeat", "settleAnswer", "startPairing"]);
  expect(lines[1]).toMatchObject({ requestId: "r-1", outcome: "read", reply: "On it" });
  expect(await cloud.takeAnswers()).toEqual([]);
  writeFileSync(`${path}.answers`, JSON.stringify([{ requestId: "r-2", key: "t@t@1", task: "t", decision: "t", kind: "approve", text: "", submittedAt: 3 }]));
  expect((await cloud.takeAnswers()).map((a) => a.requestId)).toEqual(["r-2"]);
});

const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("convexCloud posts the path, the secret and the arguments to Convex's own API", async () => {
  const seen: { url: string; body: any }[] = [];
  const cloud = convexCloud("https://happy-otter-123.eu-west-1.convex.cloud/", "S".repeat(40), async (url, init) => {
    seen.push({ url, body: JSON.parse(String(init.body)) });
    return reply(200, { status: "success", value: [] });
  });
  await cloud.heartbeat(5, "0.1.0", "homelab");
  await cloud.takeAnswers();
  expect(seen[0]).toEqual({ url: "https://happy-otter-123.eu-west-1.convex.cloud/api/mutation", body: { path: "companion:heartbeat", args: { secret: "S".repeat(40), at: 5, version: "0.1.0", label: "homelab" }, format: "json" } });
  expect(seen[1]!.url).toBe("https://happy-otter-123.eu-west-1.convex.cloud/api/query");
  expect(seen[1]!.body.path).toBe("companion:takeAnswers");
});

test("a failed call says what failed and never the secret, the address or the payload", async () => {
  const secret = "SECRET-".repeat(8);
  const url = "https://private-name-1.convex.cloud";
  const fails: [string, () => Promise<Response>][] = [
    ["unreachable", async () => { throw new TypeError(`fetch failed ${url} ${secret}`); }],
    ["timeout", async () => { const e = new Error("x"); e.name = "TimeoutError"; throw e; }],
    ["refused", async () => reply(200, { status: "error", errorMessage: `refused ${secret}` })],
    ["http 502", async () => reply(502, "<html>bad gateway</html>")],
    ["http 403", async () => reply(403, { status: "x" })],
    ["http 200", async () => reply(200, `<html>${secret}</html>`)],
    ["http 500", async () => reply(500, `oops ${secret}`)],
  ];
  for (const [expected, f] of fails) {
    const err = await convexCloud(url, secret, f).heartbeat(1, "v", "l").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CloudError);
    expect((err as CloudError).status).toBe(expected);
    expect(String((err as Error).message) + JSON.stringify(err)).not.toContain("SECRET");
    expect(String((err as Error).message)).not.toContain("convex.cloud");
  }
});

test("companion.env is read only when it is private, the user's own and names a Convex deployment and a secret", () => {
  const dir = scratch();
  const file = join(dir, "companion.env");
  const body = `# the cloud\nCONVEX_URL=https://happy-otter-123.convex.cloud\nKINAS_COMPANION_SECRET="${"s".repeat(40)}"\n`;
  writeFileSync(file, body);
  chmodSync(file, 0o600);
  expect(readCompanionEnv(file, process.getuid?.() ?? -1)).toEqual({ url: "https://happy-otter-123.convex.cloud", secret: "s".repeat(40), label: "Linux machine", phoneUrl: null });
  writeFileSync(file, `${body}KINAS_PHONE_URL=https://kinas-phone.example.vercel.app\n`);
  expect(readCompanionEnv(file, -1)).toMatchObject({ phoneUrl: "https://kinas-phone.example.vercel.app" });
  writeFileSync(file, `${body}KINAS_PHONE_URL=http://insecure.example.com\n`);
  expect(readCompanionEnv(file, -1)).toEqual({ error: "KINAS_PHONE_URL is not an https address" });
  writeFileSync(file, body);
  writeFileSync(file, `${body}KINAS_COMPANION_LABEL=homelab\n`);
  expect(readCompanionEnv(file, -1)).toMatchObject({ label: "homelab" });
  writeFileSync(file, `${body}KINAS_COMPANION_LABEL=Home Lab!\n`);
  expect(readCompanionEnv(file, -1)).toEqual({ error: "KINAS_COMPANION_LABEL is not a label" });
  writeFileSync(file, body);
  chmodSync(file, 0o644);
  expect(readCompanionEnv(file, process.getuid?.() ?? -1)).toEqual({ error: "companion.env must be mode 0600" });
  chmodSync(file, 0o600);
  expect(readCompanionEnv(join(dir, "nope.env"), -1)).toEqual({ error: "no companion.env" });
  writeFileSync(file, body.replace("happy-otter-123.convex.cloud", "evil.example.com"));
  expect(readCompanionEnv(file, -1)).toEqual({ error: "CONVEX_URL is not a Convex deployment's https address" });
  writeFileSync(file, body.replace("s".repeat(40), "short"));
  expect(readCompanionEnv(file, -1)).toEqual({ error: "KINAS_COMPANION_SECRET is missing or too short" });
  writeFileSync(file, body);
  expect(JSON.stringify(readCompanionEnv(file, process.getuid?.() ?? 0 + 1) ?? "")).toContain("s".repeat(40));
});

function recorder(fail: { on: boolean } = { on: false }): { cloud: Cloud; calls: string[] } {
  const calls: string[] = [];
  const guard = () => { if (fail.on) throw new CloudError("unreachable"); };
  const cloud: Cloud = {
    replaceReading: async () => { guard(); calls.push("replace"); },
    heartbeat: async () => { guard(); calls.push("beat"); },
    takeAnswers: async () => [],
    settleAnswer: async () => {},
    startPairing: async () => {},
    phones: async () => [],
    unpair: async () => {},
    testNotification: async () => {},
  };
  return { cloud, calls };
}

test("tending: the first reading beats and sends; a quiet one sends nothing; a changed one sends; time alone sends at five minutes", async () => {
  const { cloud, calls } = recorder();
  const st = freshTend();
  const logs: string[] = [];
  const log = (l: string) => logs.push(l);
  await tendCloud(cloud, reading(), "homelab", "0.1.0", st, AT, log);
  expect(calls).toEqual(["beat", "replace"]);
  await tendCloud(cloud, reading({ at: AT + 15_000 }), "homelab", "0.1.0", st, AT + 15_000, log);
  expect(calls).toEqual(["beat", "replace"]);
  await tendCloud(cloud, reading({ at: AT + HEARTBEAT_MS }), "homelab", "0.1.0", st, AT + HEARTBEAT_MS, log);
  expect(calls).toEqual(["beat", "replace", "beat"]);
  const other = JSON.parse(snapshot);
  other.backlog.records[0].title = "A different title";
  await tendCloud(cloud, reading({}, JSON.stringify(other)), "homelab", "0.1.0", st, AT + HEARTBEAT_MS + 1, log);
  expect(calls.slice(3)).toEqual(["replace"]);
  await tendCloud(cloud, reading({}, JSON.stringify(other)), "homelab", "0.1.0", st, AT + HEARTBEAT_MS + 1 + RESEND_MS, log);
  expect(calls.slice(4)).toEqual(["beat", "replace"]);
  expect(logs).toEqual([]);
});

test("a cloud that fails is logged by its status alone, keeps nothing as sent, and the next reading tries again", async () => {
  const fail = { on: true };
  const { cloud, calls } = recorder(fail);
  const st = freshTend();
  const logs: string[] = [];
  await tendCloud(cloud, reading(), "homelab", "0.1.0", st, AT, (l) => logs.push(l));
  expect(logs).toEqual(["companion: cloud failed (unreachable)"]);
  expect(calls).toEqual([]);
  expect(st.lastHash).toBeNull();
  fail.on = false;
  await tendCloud(cloud, reading(), "homelab", "0.1.0", st, AT + 15_000, (l) => logs.push(l));
  expect(calls).toEqual(["beat", "replace"]);
});
