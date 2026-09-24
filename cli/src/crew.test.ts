import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `kinas crew …` end to end: the CLI run as a process against a real store built from migrations/ (status.test.ts's
// shape). Setup's steps are crew-setup.test.ts's; here, only what the door itself decides.

const MAIN = join(import.meta.dir, "main.ts");
const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ version: Number(f.slice(0, 4)), sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeStore(fill: (db: Database, now: number) => void, extraVersion?: number): string {
  const dir = mkdtempSync(join(tmpdir(), "kinas-crew-cli-"));
  dirs.push(dir);
  const db = new Database(join(dir, "kinas.sqlite"), { create: true });
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS) {
    db.exec(m.sql);
    db.run("INSERT INTO schema_migrations VALUES (?, 0)", [m.version]);
  }
  if (extraVersion) db.run("INSERT INTO schema_migrations VALUES (?, 0)", [extraVersion]);
  db.exec("INSERT INTO orgs VALUES ('org-1', 'default', 0)");
  fill(db, Date.now());
  db.close();
  return dir;
}

function run(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const TASK = `INSERT INTO crew_tasks (org_id, id, title, repo, project, kind, backlog_state, state, pr_url, pr_number, pr_checks_total,
  pr_checks_failed, snapshot_generated, first_seen_at, first_working_at, last_seen_at) VALUES ('org-1', ?, ?, ?, ?, 'ship', ?, ?, ?, ?, ?, ?, 'g', ?, ?, ?)`;

describe("kinas crew", () => {
  test("status --json from a seeded mirror: counts, words and PR numbers, and nothing that names a task", () => {
    const dir = makeStore((db, now) => {
      db.run(TASK, ["task-a-9c2e", "Title 9c2e", "o/r-9c2e", "/x/projects/r-9c2e", "queued", null, null, null, null, null, now, null, now]);
      db.run(TASK, ["task-b-9c2e", "Other 9c2e", "o/r-9c2e", "/x/projects/r-9c2e", "in_flight", "working", "https://github.com/o/r-9c2e/pull/7", 7, 3, 1, now, now - 60_000, now]);
      db.run("INSERT INTO crew_decisions (org_id, task_id, key, verb, summary, opened_at) VALUES ('org-1', 'task-b-9c2e', 'k-9c2e', 'needs-decision', 'Which 9c2e?', ?)", [now]);
    });
    const { code, stdout } = run(["crew", "status", "--json"], { KINAS_DATA_DIR: dir });
    expect(code).toBe(0);
    const json = JSON.parse(stdout) as { installed: boolean; counts: Record<string, number>; waiting: number; tasks: { word: string; pr: number | null }[] };
    expect(json.installed).toBe(false);
    expect(json.counts.queued).toBe(1);
    expect(json.counts.ci_red).toBe(1);
    expect(json.waiting).toBe(1);
    expect(json.tasks.map((t) => [t.word, t.pr])).toEqual([["queued", null], ["CI red", 7]]);
    expect(stdout).not.toContain("9c2e");
    for (const key of ["id", "title", "repo", "path", "url", "worktree", "home", "key", "summary", "text"]) expect(stdout).not.toContain(`"${key}"`);
  });

  test("status in plain lines", () => {
    const dir = makeStore(() => {});
    const { code, stdout } = run(["crew", "status"], { KINAS_DATA_DIR: dir });
    expect(code).toBe(0);
    expect(stdout).toContain("Firstmate   not installed — run kinas crew setup in the Work pane");
    expect(stdout).toContain("Waiting     0 on you");
  });

  test("status exits 2 with no store, 3 with a newer one", () => {
    const empty = mkdtempSync(join(tmpdir(), "kinas-crew-cli-"));
    dirs.push(empty);
    expect(run(["crew", "status"], { KINAS_DATA_DIR: empty }).code).toBe(2);
    expect(run(["crew", "status"], { KINAS_DATA_DIR: makeStore(() => {}, 99) }).code).toBe(3);
  });

  test("usage is 64: no subcommand, an unknown one, an unknown option", () => {
    const dir = makeStore(() => {});
    for (const args of [["crew"], ["crew", "bogus"], ["crew", "status", "--yaml"], ["crew", "setup", "--force"]]) {
      expect(run(args, { KINAS_DATA_DIR: dir }).code, args.join(" ")).toBe(64);
    }
  });

  test("setup asks before each step, so without a terminal it needs --yes: 64, asking nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kinas-crew-cli-"));
    dirs.push(dir);
    const { code, stderr, stdout } = run(["crew", "setup"], { KINAS_DATA_DIR: dir });
    expect(code).toBe(64);
    expect(stderr).toContain("kinas crew setup asks before each step; run it in a terminal, or pass --yes");
    expect(stdout).toBe("");
  });

  test("setup --dry-run needs no terminal and touches nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kinas-crew-cli-"));
    dirs.push(dir);
    const { code, stdout } = run(["crew", "setup", "--dry-run"], { KINAS_DATA_DIR: dir });
    expect(code).toBe(0);
    expect(stdout.split("\n").filter((l) => l.startsWith("would: ")).length).toBe(7);
    expect(readdirSync(dir)).toEqual([]);
  });
});
