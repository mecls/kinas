import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, DB_FILE, openReadOnly, readSetting } from "./sqlite-readonly.ts";

// The app writes the store while the CLI reads it (ADR 0001). A reader that meets a lock — the app recovering the WAL
// after a crash, a checkpoint that restarts it — must wait a moment, not fail: `kinas status` exiting 1 with "database
// is locked" is a reading lost for nothing. Held here against a lock another process takes and keeps for a while.

const dir = mkdtempSync(join(tmpdir(), "kinas-ro-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const db = new Database(join(dir, DB_FILE), { create: true });
db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
db.exec("INSERT INTO schema_migrations VALUES (1, 0)");
db.exec("CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)");
db.exec("INSERT INTO orgs VALUES ('org-1', 'default', 0)");
db.exec("CREATE TABLE settings (org_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (org_id, key))");
db.exec(`INSERT INTO settings VALUES ('org-1', 'projects_root', '"/r"')`);
db.close();

/** Another process holding the store exclusively for `holdMs`; resolves once it has the lock. */
async function lockedElsewhere(holdMs: number): Promise<Bun.Subprocess> {
  const script = `
    const { Database } = require("bun:sqlite");
    const db = new Database(process.argv[1]);
    db.exec("BEGIN EXCLUSIVE");
    console.log("locked");
    await Bun.sleep(${holdMs});
    db.exec("COMMIT");
    db.close();
  `;
  const proc = Bun.spawn([process.execPath, "-e", script, join(dir, DB_FILE)], { stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.getReader();
  let said = "";
  while (!said.includes("locked")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the lock holder ended without taking the lock: ${JSON.stringify(said)}`);
    said += new TextDecoder().decode(value);
  }
  return proc;
}

test("a store another process holds locked is waited for, not refused", async () => {
  const holder = await lockedElsewhere(600);
  const started = Date.now();
  const opened = openReadOnly(dir);
  expect(opened.ok, JSON.stringify(opened)).toBe(true);
  if (opened.ok) {
    expect(opened.store.orgId()).toBe("org-1");
    opened.store.close();
  }
  // It waited for the lock rather than failing at once; the holder let go after 600 ms.
  expect(Date.now() - started).toBeGreaterThan(200);
  await holder.exited;
});

test("a setting is read through the same wait", async () => {
  const holder = await lockedElsewhere(600);
  expect(readSetting(dir, "projects_root")).toBe("/r");
  await holder.exited;
});

test("a blank KINAS_DATA_DIR is unset, as the app reads it; anything else is the folder, exactly as given", () => {
  // paths.rs `data_dir_override`: empty or blank (Unicode white space) is unset. The CLI took "   " as a folder, relative
  // to wherever it ran, while the app opened the default one — two stores, and `kinas status` reading neither the app's.
  const fallback = join(homedir(), "Library/Application Support/ai.sintralabs.kinas");
  for (const blank of [undefined, "", "   ", "\t\n", "\u00a0", "\u0085", "\u2028"]) expect(dataDir({ KINAS_DATA_DIR: blank }), JSON.stringify(blank)).toBe(fallback);
  expect(dataDir({ KINAS_DATA_DIR: "/tmp/kinas-9c2e" })).toBe("/tmp/kinas-9c2e");
  expect(dataDir({ KINAS_DATA_DIR: " /tmp/kinas 9c2e " })).toBe(" /tmp/kinas 9c2e ");
  // Rust's `trim` is Unicode White_Space, which U+FEFF is not.
  expect(dataDir({ KINAS_DATA_DIR: "\ufeff" })).toBe("\ufeff");
});
