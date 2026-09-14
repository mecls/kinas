// The CLI's door to the store (PRD R7, R10): read-only, never a writer. The app keeps the WAL files on
// disk (R7), so this open works with the app quit.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "./schema-version.ts";
import type { HostRow, ModelRequests, QuotaRow, ReaderRow, StorageAdapter, UsageRow } from "./types.ts";

export const DB_FILE = "kinas.sqlite";

/** `KINAS_DATA_DIR`, else `~/Library/Application Support/ai.sintralabs.kinas`. */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.KINAS_DATA_DIR || join(homedir(), "Library/Application Support/ai.sintralabs.kinas");
}

export type OpenResult =
  | { ok: true; store: SqliteReadOnlyStore }
  | { ok: false; reason: "missing"; path: string }
  | { ok: false; reason: "newer"; version: number }
  | { ok: false; reason: "unreadable"; message: string };

export function openReadOnly(dir: string): OpenResult {
  const path = join(dir, DB_FILE);
  if (!existsSync(path)) return { ok: false, reason: "missing", path };
  let db: Database;
  try {
    db = new Database(`file:${path}?mode=ro`, { readonly: true });
  } catch (e) {
    return { ok: false, reason: "unreadable", message: (e as Error).message };
  }
  const store = new SqliteReadOnlyStore(db);
  try {
    const version = store.schemaVersion();
    if (version > SCHEMA_VERSION) {
      store.close();
      return { ok: false, reason: "newer", version };
    }
    store.orgId();
  } catch (e) {
    store.close();
    return { ok: false, reason: "unreadable", message: (e as Error).message };
  }
  return { ok: true, store };
}

/** The stored `quotas.models` JSON; anything unreadable is no models, never a failed status. */
export function parseModels(stored: string | null): ModelRequests[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ModelRequests => typeof m === "object" && m !== null && typeof m.name === "string" && typeof m.request_count === "number",
    );
  } catch {
    return [];
  }
}

export class SqliteReadOnlyStore implements StorageAdapter {
  private org: string | undefined;

  constructor(private readonly db: Database) {}

  close(): void {
    this.db.close();
  }

  orgId(): string {
    if (this.org === undefined) {
      const row = this.db.query("SELECT id FROM orgs LIMIT 1").get() as { id: string } | null;
      if (!row) throw new Error("the store has no org yet");
      this.org = row.id;
    }
    return this.org;
  }

  schemaVersion(): number {
    const row = this.db.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
    return row.v;
  }

  /** Migration 2 added `quotas.models` and `hosts.disk_available_gb`; a store the app has not migrated yet lacks them. */
  private get hasUsageDetails(): boolean {
    return this.schemaVersion() >= 2;
  }

  getQuotas(): QuotaRow[] {
    const rows = this.db
      .query(
        `SELECT subscription, "window" AS window, used_pct, resets_at, plan, source, updated_at,
                ${this.hasUsageDetails ? "models" : "NULL AS models"}
         FROM quotas
         WHERE org_id = ?1 ORDER BY subscription, CASE "window" WHEN 'session' THEN 0 WHEN 'week' THEN 1 ELSE 2 END`,
      )
      .all(this.orgId()) as (Omit<QuotaRow, "models"> & { models: string | null })[];
    return rows.map((r) => ({ ...r, models: parseModels(r.models) }));
  }

  getReaderStatus(): ReaderRow[] {
    return this.db
      .query(
        `SELECT reader, state, last_attempt_at, last_success_at, last_error, stale_after_ms, dead_after_ms
         FROM reader_status WHERE org_id = ?1 ORDER BY reader`,
      )
      .all(this.orgId()) as ReaderRow[];
  }

  getHost(): HostRow | null {
    return (this.db
      .query(
        `SELECT machine, cpu_pct, mem_used_gb, mem_total_gb, disk_used_gb, disk_total_gb,
                ${this.hasUsageDetails ? "disk_available_gb" : "NULL AS disk_available_gb"}, updated_at
         FROM hosts
         WHERE org_id = ?1 ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(this.orgId()) ?? null) as HostRow | null;
  }

  getUsageDaily(date: string): UsageRow[] {
    return this.db
      .query(
        `SELECT date, harness, provider, model, sum(tokens_in) AS tokens_in, sum(tokens_cache_read) AS tokens_cache_read,
                sum(tokens_out) AS tokens_out, sum(messages) AS messages
         FROM usage_daily WHERE org_id = ?1 AND date = ?2
         GROUP BY date, harness, provider, model ORDER BY harness, provider, model`,
      )
      .all(this.orgId(), date) as UsageRow[];
  }
}

const lisbonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });

export function lisbonToday(now: number): string {
  return lisbonDay.format(new Date(now));
}
