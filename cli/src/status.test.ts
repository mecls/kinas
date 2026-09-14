import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `kinas status` end to end (R37): a real store built from migrations/, the CLI run as a process.

const MAIN = join(import.meta.dir, "main.ts");
const MIGRATION = readFileSync(join(import.meta.dir, "../../migrations/0001_init.sql"), "utf8");
const dirs: string[] = [];

function makeStore(fill: (db: Database, org: string, now: number) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "kinas-cli-"));
  dirs.push(dir);
  const db = new Database(join(dir, "kinas.sqlite"), { create: true });
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  db.exec(MIGRATION);
  db.exec("INSERT INTO schema_migrations VALUES (1, 0)");
  db.exec("INSERT INTO orgs VALUES ('org-1', 'default', 0)");
  fill(db, "org-1", Date.now());
  db.close();
  return dir;
}

function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

let healthy = "";

beforeAll(() => {
  healthy = makeStore((db, org, now) => {
    db.run("INSERT INTO reader_status VALUES (?, 'claude-plan', 'ok', ?, ?, NULL, 1800000, 43200000)", [org, now, now]);
    db.run("INSERT INTO reader_status VALUES (?, 'ollama-cloud', 'error', ?, NULL, 'API key rejected', 600000, 43200000)", [org, now]);
    db.run("INSERT INTO reader_status VALUES (?, 'host', 'ok', ?, ?, NULL, 120000, 43200000)", [org, now, now]);
    // Fresh session, stale week (41 min old against the 30 min limit).
    db.run("INSERT INTO quotas VALUES (?, 'claude-plan', 'session', 42, ?, NULL, 'Claude Code status line', ?)", [org, now + 3_600_000, now - 60_000]);
    db.run("INSERT INTO quotas VALUES (?, 'claude-plan', 'week', 23.5, ?, NULL, 'Claude Code status line', ?)", [org, now + 86_400_000, now - 41 * 60_000]);
    db.run("INSERT INTO hosts VALUES (?, 'mac', 12.4, 7.2, 16, 200, 460, '[]', ?)", [org, now]);
  });
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("kinas status", () => {
  test("prints one line per quota, marks stale ones, and exits 0", () => {
    const { code, stdout } = run(["status"], { KINAS_DATA_DIR: healthy });
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Claude · session {3}58% left · resets \S+ · as of \S+$/m);
    expect(stdout).toMatch(/^Claude · week {6}76% left · .* \(stale\)$/m);
    expect(stdout).toMatch(/^Ollama {13}— · API key rejected$/m);
    expect(stdout).toMatch(/^This Mac {11}CPU 12% · memory 7\.2\/16\.0 GiB · disk free 260 GiB/m);
    expect(stdout).not.toContain("\x1b["); // no colour when not a TTY
  });

  test("--json carries left_pct, ISO times and states, and nothing secret-shaped", () => {
    const { code, stdout } = run(["status", "--json"], { KINAS_DATA_DIR: healthy });
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    const session = json.quotas.find((q: { window: string }) => q.window === "session");
    expect(session).toMatchObject({ subscription: "claude-plan", used_pct: 42, left_pct: 58, state: "fresh" });
    expect(session.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.quotas.find((q: { window: string }) => q.window === "week").state).toBe("stale");
    expect(json.quotas.find((q: { subscription: string }) => q.subscription === "ollama-cloud")).toMatchObject({ state: "dead", reason: "API key rejected" });
    expect(json.host).toMatchObject({ machine: "mac", disk_free_gb: 260, state: "fresh" });
    expect(stdout).not.toMatch(/sk-ant-|Bearer/);
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

  test("unknown commands and options exit 64; open does not exist", () => {
    expect(run(["open", "x.md"], { KINAS_DATA_DIR: healthy }).code).toBe(64);
    expect(run(["status", "--yaml"], { KINAS_DATA_DIR: healthy }).code).toBe(64);
  });
});
