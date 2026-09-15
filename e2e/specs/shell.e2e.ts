import { browser, $, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// AC-1 (the empty app and its store), and the shell rules R28 (close hides) and R33 (pages stay mounted).

const dataDir = process.env.KINAS_DATA_DIR!;
const db = join(dataDir, "kinas.sqlite");

function sql(query: string): string {
  return execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
}

async function hook<T>(name: string): Promise<T> {
  return (await browser.executeAsync((hookName: string, done: (v: unknown) => void) => {
    const hooks = (window as unknown as { __kinasTest?: Record<string, () => Promise<unknown>> }).__kinasTest;
    if (!hooks || !hooks[hookName]) return done({ error: `no test hook ${hookName}` });
    hooks[hookName]().then(done, (e: unknown) => done({ error: String(e) }));
  }, name)) as T;
}

describe("Kinas shell", () => {
  it("AC-1: opens a WAL store with one org and the latest schema", async () => {
    const info = await hook<{ org_id: string; path: string; schema_version: number }>("storeInfo");
    expect(info.path).toBe(db);
    // The latest schema is the number of migrations, so this does not go stale when one is added (it said 1 after
    // 0002_usage_details.sql raised SCHEMA_VERSION to 2).
    const latest = readdirSync(join(process.cwd(), "migrations")).filter((f) => f.endsWith(".sql")).length;
    expect(info.schema_version).toBe(latest);
    expect(sql("PRAGMA journal_mode")).toBe("wal");
    expect(sql("SELECT count(*) FROM orgs")).toBe("1");
    expect(sql("SELECT id FROM orgs")).toBe(info.org_id);
    const missingOrgId = sql(
      "SELECT count(*) FROM sqlite_master m WHERE m.type = 'table' AND m.name NOT IN ('orgs','schema_migrations','sqlite_sequence') AND NOT EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name = 'org_id' AND p.\"notnull\" = 1)",
    );
    expect(missingOrgId).toBe("0");
  });

  it("starts on the Usage page; ⌘2 and ⌘1 switch pages", async () => {
    await expect($('section[data-page="usage"]')).toBeDisplayed();
    await expect($('section[data-page="work"]')).not.toBeDisplayed();
    await browser.keys(["Meta", "2"]);
    await expect($('section[data-page="work"]')).toBeDisplayed();
    await expect($('section[data-page="usage"]')).not.toBeDisplayed();
    await browser.keys(["Meta", "1"]);
    await expect($('section[data-page="usage"]')).toBeDisplayed();
  });

  it("R28: closing the window hides it and the app keeps running", async () => {
    await hook("closeWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === false, {
      timeoutMsg: "window still visible after close",
    });
    expect(existsSync(db)).toBe(true);
    await hook("showWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === true);
  });
});
