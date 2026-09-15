import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `kinas status` end to end (R37): a real store built from migrations/, the CLI run as a process.

const MAIN = join(import.meta.dir, "main.ts");
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ version: Number(f.slice(0, 4)), sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
const dirs: string[] = [];

/** A store migrated up to `upTo` (default: every migration), like the app leaves it. */
function makeStore(fill: (db: Database, org: string, now: number) => void, upTo = Infinity): string {
  const dir = mkdtempSync(join(tmpdir(), "kinas-cli-"));
  dirs.push(dir);
  const db = new Database(join(dir, "kinas.sqlite"), { create: true });
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS.filter((m) => m.version <= upTo)) {
    db.exec(m.sql);
    db.run("INSERT INTO schema_migrations VALUES (?, 0)", [m.version]);
  }
  db.exec("INSERT INTO orgs VALUES ('org-1', 'default', 0)");
  fill(db, "org-1", Date.now());
  db.close();
  return dir;
}

function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const QUOTA = `INSERT INTO quotas (org_id, subscription, "window", used_pct, resets_at, plan, source, updated_at, models) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`;
const HOST = `INSERT INTO hosts (org_id, machine, cpu_pct, mem_used_gb, mem_total_gb, disk_used_gb, disk_total_gb, disk_available_gb, services, updated_at)
              VALUES (?, 'mac', 12.4, 7.2, 16, 200, 460, ?, '[]', ?)`;

let healthy = "";

beforeAll(() => {
  healthy = makeStore((db, org, now) => {
    db.run("INSERT INTO reader_status VALUES (?, 'claude-plan', 'ok', ?, ?, NULL, 1800000, 43200000)", [org, now, now]);
    db.run("INSERT INTO reader_status VALUES (?, 'ollama-cloud', 'error', ?, NULL, 'API key rejected', 600000, 43200000)", [org, now]);
    db.run("INSERT INTO reader_status VALUES (?, 'host', 'ok', ?, ?, NULL, 120000, 43200000)", [org, now, now]);
    // Fresh session, stale week (41 min old against the 30 min limit).
    db.run(QUOTA, [org, "claude-plan", "session", 42, now + 3_600_000, "Claude Code status line", now - 60_000, null]);
    db.run(QUOTA, [org, "claude-plan", "week", 23.5, now + 86_400_000, "Claude Code status line", now - 41 * 60_000, null]);
    // 280 GiB available in Finder's sense (free 260 GiB plus purgeable).
    db.run(HOST, [org, 280, now]);
  });
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("kinas status", () => {
  test("prints one line per quota, marks stale ones, and exits 0", () => {
    const { code, stdout } = run(["status"], { KINAS_DATA_DIR: healthy });
    expect(code).toBe(0);
    // After 23:00 the reset (an hour away) is tomorrow, and the line carries the date too.
    expect(stdout).toMatch(/^Claude · session {3}58% left · resets (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} · as of \S+$/m);
    expect(stdout).toMatch(/^Claude · week {6}76% left · .* \(stale\)$/m);
    expect(stdout).toMatch(/^Ollama {13}— · API key rejected$/m);
    // 280 GiB = 300.6 GB, floored.
    expect(stdout).toMatch(/^This Mac {11}CPU 12% · memory 7\.2\/16\.0 GiB · disk available 300 GB/m);
    expect(stdout).not.toContain("\x1b["); // no colour when not a TTY
  });

  test("--json carries left_pct, ISO times and states, and nothing secret-shaped", () => {
    const { code, stdout } = run(["status", "--json"], { KINAS_DATA_DIR: healthy });
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    const session = json.quotas.find((q: { window: string }) => q.window === "session");
    expect(session).toMatchObject({ subscription: "claude-plan", used_pct: 42, left_pct: 58, state: "fresh", models: [] });
    expect(session.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.quotas.find((q: { window: string }) => q.window === "week").state).toBe("stale");
    expect(json.quotas.find((q: { subscription: string }) => q.subscription === "ollama-cloud")).toMatchObject({ state: "dead", reason: "API key rejected" });
    expect(json.host).toMatchObject({ machine: "mac", disk_free_gb: 260, disk_available_gb: 280, state: "fresh" });
    expect(stdout).not.toMatch(/sk-ant-|Bearer/);
  });

  test("AC-2: a legacy Ollama plan at 2.5 % used is 97.5 left in JSON and 97% left in text, with its models", () => {
    const ollama = makeStore((db, org, now) => {
      db.run("INSERT INTO reader_status VALUES (?, 'ollama-cloud', 'ok', ?, ?, NULL, 600000, 43200000)", [org, now, now]);
      db.run(QUOTA, [org, "ollama-cloud", "session", 2.5, null, "ollama.com/api/usage", now - 60_000, '[{"name":"glm-5.3:cloud","request_count":12}]']);
    });
    const json = JSON.parse(run(["status", "--json"], { KINAS_DATA_DIR: ollama }).stdout);
    expect(json.quotas.find((q: { subscription: string }) => q.subscription === "ollama-cloud")).toMatchObject({
      window: "session",
      used_pct: 2.5,
      left_pct: 97.5,
      state: "fresh",
      models: [{ name: "glm-5.3:cloud", request_count: 12 }],
    });
    expect(run(["status"], { KINAS_DATA_DIR: ollama }).stdout).toMatch(/^Ollama · session\s+97% left/m);
  });

  test("a store the app has not migrated yet still reads, without the newer details", () => {
    const v1 = makeStore((db, org, now) => {
      db.run("INSERT INTO hosts VALUES (?, 'mac', 12.4, 7.2, 16, 200, 460, '[]', ?)", [org, now]);
    }, 1);
    const { code, stdout } = run(["status"], { KINAS_DATA_DIR: v1 });
    expect(code).toBe(0);
    // 260 GiB free = 279.2 GB, floored.
    expect(stdout).toContain("disk free 279 GB");
  });

  test("a store that does not exist exits 2", () => {
    const { code, stderr } = run(["status"], { KINAS_DATA_DIR: mkdtempSync(join(tmpdir(), "kinas-cli-empty-")) });
    expect(code).toBe(2);
    expect(stderr).toContain("Kinas hasn't run yet — open the app once");
    // Plain text when stderr is not a terminal: no colour escapes.
    expect(stderr).not.toContain("\x1b");
  });

  test("a store newer than the CLI exits 3", () => {
    const newer = makeStore((db) => db.exec("INSERT INTO schema_migrations VALUES (99, 0)"));
    const { code, stderr } = run(["status"], { KINAS_DATA_DIR: newer });
    expect(code).toBe(3);
    expect(stderr).toContain("the ~/.local/bin link is stale");
  });

  test("an empty store: providers not connected, no usage, no host", () => {
    const empty = makeStore(() => {});
    const { code, stdout } = run(["status"], { KINAS_DATA_DIR: empty });
    expect(code).toBe(0);
    expect(stdout).toContain("Claude             not connected — add the Claude Code hook in Settings");
    expect(stdout).toContain("Ollama             not connected — add an API key in Settings");
    expect(stdout).toContain("Today              no model usage yet");
  });

  test("unknown commands and options exit 64", () => {
    expect(run(["deploy"], { KINAS_DATA_DIR: healthy }).code).toBe(64);
    expect(run(["status", "--yaml"], { KINAS_DATA_DIR: healthy }).code).toBe(64);
  });
});
