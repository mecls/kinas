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

/** The CLI as a process, piped; colour as the test asks for it, never as the shell running the tests has it. */
function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, FORCE_COLOR: "", NO_COLOR: "", ...env }, stdout: "pipe", stderr: "pipe" });
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

  test("a model name or a reader's error with a control sequence in it is printed as text, never obeyed by the terminal", () => {
    // Model names come from the transcripts and a reader's error from what a provider answered: an escape there would
    // reach the terminal running `kinas status` as a command (OSC 52 sets its clipboard).
    const dir = makeStore((db, org, now) => {
      db.run("INSERT INTO reader_status VALUES (?, 'ollama-cloud', 'error', ?, NULL, ?, 600000, 43200000)", [org, now, "bad \x1b]52;c;ZWNobyBoaQ==\x07 key"]);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
      db.run(
        "INSERT INTO usage_daily (org_id, date, provider, model, harness, source, machine, tokens_in, tokens_cache_read, tokens_out, messages) VALUES (?, ?, 'p', ?, 'pi', 'interactive', 'm', 1, 0, 1, 1)",
        [org, today, "glm\x1b[2J\x07-9c2e"],
      );
    });
    for (const env of [{}, { FORCE_COLOR: "1" }] as Record<string, string>[]) {
      const { code, stdout } = run(["status"], { KINAS_DATA_DIR: dir, ...env });
      expect(code).toBe(0);
      expect(stdout).not.toMatch(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]|\x1b(?!\[[0-9;]*m)/);
      expect(stdout).toContain("pi · glm\uFFFD[2J\uFFFD-9c2e");
      expect(stdout).toContain("— · bad \uFFFD]52;c;ZWNobyBoaQ==\uFFFD key");
    }
  });

  test("a model name's or a reader error's own colour codes are shown, not obeyed: only `kinas status` paints", () => {
    // The lines went through `flat` after they were painted, and `flat` keeps `ESC [ … m` for that paint: a model name
    // holding `ESC [ 8 m` concealed the rest of the screen, its prompt included, since nothing of the CLI's reset it.
    const dir = makeStore((db, org, now) => {
      db.run("INSERT INTO reader_status VALUES (?, 'ollama-cloud', 'error', ?, NULL, ?, 600000, 43200000)", [org, now, "bad \x1b[30;40mkey"]);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
      db.run(
        "INSERT INTO usage_daily (org_id, date, provider, model, harness, source, machine, tokens_in, tokens_cache_read, tokens_out, messages) VALUES (?, ?, 'p', ?, 'pi', 'interactive', 'm', 1, 0, 1, 1)",
        [org, today, "glm\x1b[8m-9c2e"],
      );
    });
    const plain = run(["status"], { KINAS_DATA_DIR: dir });
    expect(plain.code).toBe(0);
    expect(plain.stdout).not.toContain("\x1b");
    expect(plain.stdout).toContain("pi · glm\uFFFD[8m-9c2e");
    expect(plain.stdout).toContain("— · bad \uFFFD[30;40mkey");
    const forced = run(["status"], { KINAS_DATA_DIR: dir, FORCE_COLOR: "1" });
    expect(forced.stdout).not.toMatch(/\x1b\[(?:8|30;40)m/);
  });

  test("FORCE_COLOR paints a stale line gold even when piped, as every other command and the README have it; NO_COLOR wins", () => {
    const forced = run(["status"], { KINAS_DATA_DIR: healthy, FORCE_COLOR: "1", NO_COLOR: "" });
    expect(forced.code).toBe(0);
    expect(forced.stdout).toMatch(/^\x1b\[33mClaude · week {6}76% left · .* \(stale\)\x1b\[0m$/m);
    // The fresh line stays plain: gold is for what is stale, nothing else.
    expect(forced.stdout).toMatch(/^Claude · session {3}58% left/m);
    expect(run(["status"], { KINAS_DATA_DIR: healthy, FORCE_COLOR: "1", NO_COLOR: "1" }).stdout).not.toContain("\x1b[");
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
