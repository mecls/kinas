// Rows as the store holds them, and the StorageAdapter every reader of the store goes through (PRD R36).
// Build 1 has one implementation, the CLI's read-only SQLite adapter; the reference design's later Convex
// store is a second implementation of the same interface, not a redesign.

import type { QuotaWindow, Subscription } from "./quota-line.ts";

export type { QuotaWindow, Subscription };
export type ReaderId = "claude-plan" | "ollama-cloud" | "claude-code-logs" | "pi-logs" | "host" | "convex" | "hostinger" | "crew";

export interface ModelRequests {
  name: string;
  request_count: number;
}

export interface QuotaRow {
  subscription: Subscription;
  window: QuotaWindow;
  used_pct: number;
  resets_at: number | null;
  plan: string | null;
  source: string;
  updated_at: number;
  /** Per-model request counts the provider reports for this window (Ollama); empty otherwise. */
  models: ModelRequests[];
}

export interface ReaderRow {
  reader: ReaderId;
  state: "ok" | "error" | "not_configured";
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  stale_after_ms: number;
  dead_after_ms: number;
}

/** Sizes are GiB, whatever the `_gb` suffix says; surfaces convert disk sizes to Finder's decimal GB. */
export interface HostRow {
  machine: string;
  cpu_pct: number | null;
  mem_used_gb: number;
  mem_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  /** Finder's "available": free space plus purgeable space macOS clears; null when not reported. */
  disk_available_gb: number | null;
  updated_at: number;
}

export interface UsageRow {
  date: string;
  harness: "claude-code" | "pi";
  provider: string;
  model: string;
  tokens_in: number;
  tokens_cache_read: number;
  tokens_out: number;
  messages: number;
}

/** A crew task as the app's mirror holds it (migration 5), with the columns the word rule reads. */
export interface CrewTaskRow {
  state: string | null;
  backlog_state: string | null;
  pending_decision: number;
  captain_actionable: number;
  blocked_event: number;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
  pr_draft: number | null;
  pr_mergeable: string | null;
  pr_checks_total: number | null;
  pr_checks_failed: number | null;
  first_working_at: number | null;
  done_at: number | null;
  gone_at: number | null;
}

/** One task as the mirror holds it, for the context packet's Crew section (the first mate, slice 9). */
export interface CrewMirrorRow {
  id: string;
  title: string | null;
  project: string | null;
  project_name: string | null;
  kind: string;
  backlog_state: string | null;
  state: string | null;
  worktree_path: string | null;
  report_path: string | null;
  report_present: number;
  captain_actionable: number;
  snapshot_generated: string;
  done_at: number | null;
  gone_at: number | null;
}

/** One open decision, with its task's title. */
export interface CrewDecisionRow {
  task_id: string;
  verb: string;
  summary: string;
  task_title: string | null;
}

/** The crew's reads (schema 5): empty on an older store, never a failure. */
export interface CrewStore {
  schemaVersion(): number;
  /** Every task inside the board's retention: done within 7 days, gone within 24 h. */
  getCrewTasks(now: number): CrewTaskRow[];
  /** Open decisions: the one waiting count (build spec §6.12). */
  getCrewWaiting(): number;
  /** What the app last saw of the crew's install (the `crew_health` setting), or null. */
  getCrewHealth(): unknown;
  /** Every task inside the board's retention, with what the context packet shows of it. */
  getCrewMirror(now: number): CrewMirrorRow[];
  /** The open decisions, oldest first. */
  getCrewDecisions(): CrewDecisionRow[];
}

export interface StorageAdapter {
  schemaVersion(): number;
  getQuotas(): QuotaRow[];
  getReaderStatus(): ReaderRow[];
  getHost(): HostRow | null;
  /** One Europe/Lisbon date, summed per harness/provider/model. */
  getUsageDaily(date: string): UsageRow[];
}
