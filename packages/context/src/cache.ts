// kinas-cli.sqlite: the packet computed last, and the activity log. Two CLI processes can touch it at once (the
// launch screen and its background refresh), so it runs in WAL with a busy timeout and migrates inside a write
// transaction.

/// <reference path="./sql.d.ts" />

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import MIGRATION_0001 from "../migrations/0001_context_cache.sql" with { type: "text" };
import { PACKET_VERSION, type ActivityKind, type ActivityRow, type Packet } from "./packet.ts";
import { within } from "./time.ts";

export const CACHE_FILE = "kinas-cli.sqlite";
export const CACHE_MIGRATIONS: readonly { version: number; sql: string }[] = [{ version: 1, sql: MIGRATION_0001 }];
export const CACHE_SCHEMA_VERSION = CACHE_MIGRATIONS[CACHE_MIGRATIONS.length - 1]!.version;
/** Activity rows kept per org; older ones are dropped on write. */
const ACTIVITY_KEPT = 1_000;

export interface ActivityEvent extends ActivityRow {
  ref: string;
}

export class CacheNewerError extends Error {}

export class ContextCache {
  private constructor(
    private readonly db: Database,
    readonly path: string,
  ) {}

  /** Opens or creates the cache in `dir`. Throws CacheNewerError when a newer CLI has migrated it. */
  static open(dir: string): ContextCache {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, CACHE_FILE);
    const db = new Database(path, { create: true });
    try {
      db.exec("PRAGMA busy_timeout = 2000");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
      db.transaction(() => {
        const current = (db.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number }).v;
        if (current > CACHE_SCHEMA_VERSION) throw new CacheNewerError(`the CLI cache is newer than this CLI (version ${current})`);
        for (const m of CACHE_MIGRATIONS.filter((m) => m.version > current)) {
          db.exec(m.sql);
          db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [m.version, Date.now()]);
        }
      }).immediate();
    } catch (e) {
      db.close();
      throw e;
    }
    return new ContextCache(db, path);
  }

  close(): void {
    this.db.close();
  }

  schemaVersion(): number {
    return (this.db.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number }).v;
  }

  /** The last packet, or null when there is none or it was written by another packet version. */
  readPacket(org: string): { packet: Packet; computedAt: number } | null {
    const row = this.db.query("SELECT body, computed_at FROM packet_cache WHERE org_id = ? AND key = 'packet'").get(org) as { body: string; computed_at: number } | null;
    if (!row) return null;
    try {
      const packet = JSON.parse(row.body) as Packet;
      return packet.version === PACKET_VERSION ? { packet, computedAt: row.computed_at } : null;
    } catch {
      return null;
    }
  }

  /**
   * Keeps the packet begun last. Runs started side by side read the same packet before, and the one begun later can
   * finish first: written over it, the earlier one would put an older crew back, and the next run would count the later
   * one's changes again. A stored stamp in what is now the future (the clock stepped back) is no later moment, and is
   * replaced; the clock is read as the row is.
   */
  writePacket(org: string, packet: Packet): void {
    this.db.run(
      `INSERT INTO packet_cache (org_id, key, body, computed_at) VALUES (?1, 'packet', ?2, ?3)
       ON CONFLICT (org_id, key) DO UPDATE SET body = excluded.body, computed_at = excluded.computed_at
       WHERE excluded.computed_at >= packet_cache.computed_at OR packet_cache.computed_at > ?4`,
      [org, JSON.stringify(packet), packet.generated_at, Date.now()],
    );
  }

  /**
   * Takes the refresh lease unless another refresh took it less than `leaseMs` ago. `now` may be a clock, read once the
   * lease is: another process takes it with no guard this shares, and a lease stamped after an earlier look at the clock
   * would read as from before a clock step back, and be taken again beside it.
   */
  claimRefresh(org: string, clock: number | (() => number), leaseMs: number): boolean {
    return this.db
      .transaction(() => {
        const row = this.db.query("SELECT computed_at FROM packet_cache WHERE org_id = ? AND key = 'refresh-lease'").get(org) as { computed_at: number } | null;
        const now = typeof clock === "function" ? clock() : clock;
        if (row && within(row.computed_at, now, leaseMs)) return false;
        this.db.run(
          `INSERT INTO packet_cache (org_id, key, body, computed_at) VALUES (?, 'refresh-lease', ?, ?)
           ON CONFLICT (org_id, key) DO UPDATE SET body = excluded.body, computed_at = excluded.computed_at`,
          [org, String(process.pid), now],
        );
        return true;
      })
      .immediate();
  }

  releaseRefresh(org: string): void {
    this.db.run("DELETE FROM packet_cache WHERE org_id = ? AND key = 'refresh-lease'", [org]);
  }

  record(org: string, events: readonly ActivityEvent[], now: number): void {
    if (events.length === 0) return;
    const insert = this.db.prepare("INSERT OR IGNORE INTO activity_log (org_id, ref, at, kind, project, text, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.db.transaction(() => {
      for (const e of events) insert.run(org, e.ref, e.at, e.kind, e.project, e.text, now);
      this.db.run(
        `DELETE FROM activity_log WHERE org_id = ?1 AND ref NOT IN
           (SELECT ref FROM activity_log WHERE org_id = ?1 ORDER BY at DESC LIMIT ?2)`,
        [org, ACTIVITY_KEPT],
      );
    })();
  }

  recent(org: string, limit: number): ActivityRow[] {
    return this.db
      // `ref` settles ties (git keeps whole seconds), so the same log always renders in the same order.
      .query("SELECT at, kind, project, text FROM activity_log WHERE org_id = ? ORDER BY at DESC, recorded_at DESC, ref LIMIT ?")
      .all(org, limit) as { at: number; kind: ActivityKind; project: string | null; text: string }[];
  }
}
