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

export interface StorageAdapter {
  schemaVersion(): number;
  getQuotas(): QuotaRow[];
  getReaderStatus(): ReaderRow[];
  getHost(): HostRow | null;
  /** One Europe/Lisbon date, summed per harness/provider/model. */
  getUsageDaily(date: string): UsageRow[];
}
