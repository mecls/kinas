// Rows as the store holds them, and the StorageAdapter every reader of the store goes through (PRD R36).
// Build 1 has one implementation, the CLI's read-only SQLite adapter; the reference design's later Convex
// store is a second implementation of the same interface, not a redesign.

import type { QuotaWindow, Subscription } from "./quota-line.ts";

export type { QuotaWindow, Subscription };
export type ReaderId = "claude-plan" | "ollama-cloud" | "claude-code-logs" | "pi-logs" | "host";

export interface QuotaRow {
  subscription: Subscription;
  window: QuotaWindow;
  used_pct: number;
  resets_at: number | null;
  plan: string | null;
  source: string;
  updated_at: number;
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

export interface HostRow {
  machine: string;
  cpu_pct: number | null;
  mem_used_gb: number;
  mem_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
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

export interface StorageAdapter {
  schemaVersion(): number;
  getQuotas(): QuotaRow[];
  getReaderStatus(): ReaderRow[];
  getHost(): HostRow | null;
  /** One Europe/Lisbon date, summed per harness/provider/model. */
  getUsageDaily(date: string): UsageRow[];
}
