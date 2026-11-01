import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// AC-10's leak scan reads the store and the logs under `~/Library/Application Support/ai.sintralabs.kinas` — a path
// with a space in it. Run against a home of that shape: a clean store must PASS, and a leak must name the file whole.
// The Keychain is never asked (the key prefixes are given), the private-names grep looks for a name no file has, and
// nothing outside the scratch home is touched; the installed-app checks fail here, as they do on any Mac without it.

const repo = join(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "kinas-ac10-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function ac10(name: string, storeText: string, prefixes: Record<string, string> = {}): { out: string; store: string } {
  const home = join(scratch, name, "home dir");
  const data = join(home, "Library/Application Support/ai.sintralabs.kinas");
  const logs = join(home, "Library/Logs/ai.sintralabs.kinas");
  mkdirSync(data, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const store = join(data, "kinas.sqlite");
  writeFileSync(store, storeText);
  writeFileSync(join(logs, "kinas.log"), `store open at ${store}\n`);
  const r = spawnSync("bash", ["scripts/acceptance.sh", "ac10"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      // Assembled here so that this file does not carry the very name the grep must not find.
      KINAS_PRIVATE_NAMES: ["no-such", "name", "9c2e"].join("-"),
      KINAS_CONVEX_KEY_PREFIX: "convex-9c2e-",
      KINAS_HOSTINGER_TOKEN_PREFIX: "hosting-9c2e",
      ...prefixes,
    },
  });
  return { out: `${r.stdout}${r.stderr}`, store };
}

test("a clean store under a path with a space passes the leak scan", () => {
  const { out } = ac10("clean", "nothing secret here\n");
  expect(out).toContain("PASS  no private names in the repository");
  expect(out).toContain("PASS  no sk-ant- in the store or the logs");
  expect(out).toContain("PASS  no Bearer or Convex credential header in the store or the logs");
  expect(out).toContain("PASS  the Convex deploy key is not in the store, the logs or kinas status --json");
  expect(out).toContain("PASS  the Hostinger API token is not in the store, the logs or kinas status --json");
});

test("a leak is named by its file, path and all", () => {
  const { out, store } = ac10("leaky", "sk-ant-9c2e\nAuthorization: Bearer x\nconvex-9c2e-rest\n");
  expect(out).toContain(`FAIL  sk-ant- found:`);
  expect(out).toContain(`${store}: 1`);
  expect(out).toContain("FAIL  a credential header was found:");
  expect(out).toContain("FAIL  the Convex deploy key leaked");
});

test("a key prefix that starts with a dash is looked for, not read as grep's options", () => {
  // A token is whatever the Keychain holds: one starting with `-f` made grep take the rest as a file of patterns, fail,
  // and the scan count that failure as a hit — a clean store reported the key leaked.
  const prefixes = { KINAS_CONVEX_KEY_PREFIX: "-f9c2e-convx", KINAS_HOSTINGER_TOKEN_PREFIX: "-f9c2e-hostn" };
  const clean = ac10("dash-clean", "nothing secret here\n", prefixes).out;
  expect(clean).toContain("PASS  the Convex deploy key is not in the store, the logs or kinas status --json");
  expect(clean).toContain("PASS  the Hostinger API token is not in the store, the logs or kinas status --json");
  const { out, store } = ac10("dash-leaky", "-f9c2e-convx-rest\n-f9c2e-hostn-rest\n", prefixes);
  expect(out).toContain("FAIL  the Convex deploy key leaked");
  expect(out).toContain("FAIL  the Hostinger API token leaked");
  expect(out).toContain(`${store}: 1`);
});

// AC-6 re-reads every transcript from zero by deleting log_cursors in the live store. The app is a stub here — `open`,
// `pgrep`, `osascript` and `pkill` flip one file, `sleep` returns at once — so nothing on this Mac is started, quit or
// waited for; the store is a scratch one of the real shape, and sqlite3 is the real one.
function ac6(name: string, env: Record<string, string> = {}): { out: string; db: string; data: string } {
  const home = join(scratch, name, "home dir");
  const data = join(home, "Library/Application Support/ai.sintralabs.kinas");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(home, "Library/Logs/ai.sintralabs.kinas"), { recursive: true });
  const db = join(data, "kinas.sqlite");
  const store = new Database(db, { create: true });
  store.exec(`CREATE TABLE usage_daily (org_id TEXT, date TEXT, provider TEXT, model TEXT, harness TEXT, machine TEXT,
                tokens_in INTEGER, tokens_cache_read INTEGER, tokens_out INTEGER, messages INTEGER);
              CREATE TABLE usage_seen (org_id TEXT, harness TEXT, message_key TEXT);
              CREATE TABLE log_cursors (org_id TEXT, path TEXT, inode INTEGER, "offset" INTEGER, updated_at INTEGER);
              INSERT INTO usage_daily VALUES ('o', '2026-09-10', 'anthropic', 'opus', 'claude-code', 'm-9c2e', 10, 2, 5, 1);
              INSERT INTO usage_seen VALUES ('o', 'claude-code', 'k-9c2e');
              INSERT INTO log_cursors VALUES ('o', '/t-9c2e/a.jsonl', 1, 100, 0), ('o', '/t-9c2e/b.jsonl', 2, 200, 0);`);
  store.close();
  const bin = join(scratch, name, "bin");
  const running = join(scratch, name, "running");
  mkdirSync(bin, { recursive: true });
  const stub = (tool: string, body: string) => {
    writeFileSync(join(bin, tool), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, tool), 0o755);
  };
  stub("pgrep", `[ -f '${running}' ]`);
  stub("open", `touch '${running}'`);
  stub("osascript", `rm -f '${running}'`);
  stub("pkill", `rm -f '${running}'`);
  stub("sleep", "exit 0");
  const r = spawnSync("bash", ["scripts/acceptance.sh", "ac6"], { cwd: repo, encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...env } });
  return { out: `${r.stdout}${r.stderr}`, db, data };
}

const cursors = (db: string) => {
  const store = new Database(db, { readonly: true });
  try {
    return (store.query("SELECT count(*) AS n FROM log_cursors").get() as { n: number }).n;
  } finally {
    store.close();
  }
};

test("AC-6 deletes nothing from the live store unless the captain approves that delete", () => {
  // The global rule: a delete against production runs only on the captain's yes, after a fresh backup is checked. Run
  // as it stands, AC-6 emptied log_cursors in the real store with no backup and no way back.
  const { out, db } = ac6("ac6-unapproved");
  expect(cursors(db)).toBe(2);
  expect(out).toContain("PASS  relaunch leaves past totals unchanged");
  expect(out).toContain("SKIP  re-reading from zero deletes every row of log_cursors (2 rows) in the live store, and nothing else");
  expect(out).toContain("KINAS_AC6_DELETE_CURSORS=yes scripts/acceptance.sh ac6");
  expect(out).not.toContain("re-reading every transcript from zero leaves past totals unchanged");
});

test("approved, AC-6 backs the store up and checks the backup first, deletes log_cursors alone, and says how to restore", () => {
  const { out, db, data } = ac6("ac6-approved", { KINAS_AC6_DELETE_CURSORS: "yes" });
  expect(cursors(db)).toBe(0);
  const backups = readdirSync(dirname(data)).filter((f) => /^ai\.sintralabs\.kinas-ac6-\d{8}-\d{6}\.sqlite$/.test(f));
  expect(backups.length).toBe(1);
  const backup = join(dirname(data), backups[0]!);
  expect(cursors(backup)).toBe(2);
  expect(out).toContain(`PASS  backup checked: ${backup} has every table of the store, row for row (log_cursors 2, usage_daily 1, usage_seen 1)`);
  expect(out).toContain("PASS  the delete touched log_cursors alone: every other table's count is the backup's");
  expect(out).toContain("PASS  re-reading every transcript from zero leaves past totals unchanged");
  const restore = out.split("\n").find((l) => l.includes("restore it with:"))!;
  expect(restore).toContain(`sqlite3 '${db}' ".restore '${backup}'"`);
  // The restore it prints puts the cursors back.
  spawnSync("sqlite3", [db, `.restore '${backup}'`]);
  expect(cursors(db)).toBe(2);
});
