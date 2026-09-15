import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE_FILE, ContextCache } from "./cache.ts";
import { PACKET_VERSION, type Packet } from "./packet.ts";

const dirs: string[] = [];
function dir(): string {
  const d = mkdtempSync(join(tmpdir(), "kinas-cache-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("the CLI cache", () => {
  test("migrates from version 1, and every table but schema_migrations carries org_id and a timestamp", () => {
    const d = dir();
    ContextCache.open(d).close();
    const again = ContextCache.open(d);
    expect(again.schemaVersion()).toBe(1);
    again.close();

    const db = new Database(join(d, CACHE_FILE), { readonly: true });
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations'").all() as { name: string }[]).map((t) => t.name);
    expect(tables.sort()).toEqual(["activity_log", "packet_cache"]);
    for (const t of tables) {
      const cols = db.query(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; type: string }[];
      expect(cols.find((c) => c.name === "org_id")).toMatchObject({ notnull: 1 });
      expect(cols.some((c) => /_at$/.test(c.name) && c.type === "INTEGER" && c.notnull === 1)).toBe(true);
    }
    db.close();
  });

  test("a cache migrated by a newer CLI is refused, not rewritten", () => {
    const d = dir();
    ContextCache.open(d).close();
    const db = new Database(join(d, CACHE_FILE));
    db.run("INSERT INTO schema_migrations VALUES (99, 0)");
    db.close();
    expect(() => ContextCache.open(d)).toThrow("newer than this CLI");
  });

  test("the packet round-trips per org; another packet version reads as none", () => {
    const cache = ContextCache.open(dir());
    const packet = { version: PACKET_VERSION, generated_at: 123 } as Packet;
    cache.writePacket("org-1", packet);
    expect(cache.readPacket("org-1")).toEqual({ packet, computedAt: 123 });
    expect(cache.readPacket("org-2")).toBeNull();
    cache.writePacket("org-1", { ...packet, version: PACKET_VERSION + 1 });
    expect(cache.readPacket("org-1")).toBeNull();
    cache.close();
  });

  test("one refresh at a time, until the lease runs out or is released", () => {
    const cache = ContextCache.open(dir());
    expect(cache.claimRefresh("o", 1_000, 60_000)).toBe(true);
    expect(cache.claimRefresh("o", 2_000, 60_000)).toBe(false);
    expect(cache.claimRefresh("o", 62_000, 60_000)).toBe(true);
    cache.releaseRefresh("o");
    expect(cache.claimRefresh("o", 62_001, 60_000)).toBe(true);
    cache.close();
  });

  test("an event is recorded once, and recent is newest first", () => {
    const cache = ContextCache.open(dir());
    const event = (ref: string, at: number) => ({ ref, at, kind: "commit" as const, project: "p", text: ref });
    cache.record("o", [event("a", 1), event("b", 3)], 10);
    cache.record("o", [event("a", 1), event("c", 2)], 11);
    expect(cache.recent("o", 10).map((r) => r.text)).toEqual(["b", "c", "a"]);
    expect(cache.recent("o", 2)).toHaveLength(2);
    cache.close();
  });
});
