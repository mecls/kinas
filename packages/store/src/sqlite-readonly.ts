// The CLI's door to the store (PRD R7, R10): read-only, never a writer. The app keeps the WAL files on
// disk (R7), so this open works with the app quit.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "./schema-version.ts";
import type { CrewDecisionRow, CrewMirrorRow, CrewStore, CrewTaskRow, HostRow, ModelRequests, QuotaRow, ReaderRow, StorageAdapter, UsageRow } from "./types.ts";

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

/**
 * One row of `settings`, read without opening the whole store: the CLI needs the projects folder the app's Settings
 * page saved, and must work whether or not the app has ever run. Anything unreadable is `null`, never a failure.
 */
export function readSetting(dir: string, key: string): unknown {
  const path = join(dir, DB_FILE);
  if (!existsSync(path)) return null;
  let db: Database | undefined;
  try {
    db = new Database(`file:${path}?mode=ro`, { readonly: true });
    const row = db.query("SELECT value FROM settings WHERE key = ?1 LIMIT 1").get(key) as { value: string } | null;
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
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

export class SqliteReadOnlyStore implements StorageAdapter, CrewStore {
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

  /** Migration 5 added the crew's mirror; a store the app has not migrated yet has no crew. */
  private get hasCrew(): boolean {
    return this.schemaVersion() >= 5;
  }

  getCrewTasks(now: number): CrewTaskRow[] {
    if (!this.hasCrew) return [];
    return this.db
      .query(
        `SELECT state, backlog_state, pending_decision, captain_actionable, blocked_event, pr_url, pr_number, pr_state, pr_draft,
                pr_mergeable, pr_checks_total, pr_checks_failed, first_working_at, done_at, gone_at
         FROM crew_tasks
         WHERE org_id = ?1 AND (gone_at IS NULL OR gone_at > ?2) AND (done_at IS NULL OR done_at > ?3)
         ORDER BY first_seen_at DESC, id`,
      )
      .all(this.orgId(), now - 86_400_000, now - 7 * 86_400_000) as CrewTaskRow[];
  }

  getCrewWaiting(): number {
    if (!this.hasCrew) return 0;
    const row = this.db.query("SELECT count(*) AS n FROM crew_decisions WHERE org_id = ?1 AND closed_at IS NULL").get(this.orgId()) as { n: number };
    return row.n;
  }

  getCrewMirror(now: number): CrewMirrorRow[] {
    if (!this.hasCrew) return [];
    return this.db
      .query(
        `SELECT id, title, project, project_name, kind, backlog_state, state, worktree_path, report_path, report_present,
                captain_actionable, snapshot_generated, done_at, gone_at
         FROM crew_tasks
         WHERE org_id = ?1 AND (gone_at IS NULL OR gone_at > ?2) AND (done_at IS NULL OR done_at > ?3)
         ORDER BY first_seen_at, id`,
      )
      .all(this.orgId(), now - 86_400_000, now - 7 * 86_400_000) as CrewMirrorRow[];
  }

  getCrewDecisions(): CrewDecisionRow[] {
    if (!this.hasCrew) return [];
    return this.db
      .query(
        `SELECT d.task_id, d.verb, d.summary, t.title AS task_title
         FROM crew_decisions d LEFT JOIN crew_tasks t ON t.org_id = d.org_id AND t.id = d.task_id
         WHERE d.org_id = ?1 AND d.closed_at IS NULL ORDER BY d.opened_at, d.task_id, d.key`,
      )
      .all(this.orgId()) as CrewDecisionRow[];
  }

  getCrewHealth(): unknown {
    const row = this.db.query("SELECT value FROM settings WHERE org_id = ?1 AND key = 'crew_health'").get(this.orgId()) as { value: string } | null;
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
}

const lisbonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });

export function lisbonToday(now: number): string {
  return lisbonDay.format(new Date(now));
}
