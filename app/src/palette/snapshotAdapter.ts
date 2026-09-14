// The palette's StorageAdapter (R36): the Usage snapshot the app already serves, so "Status" in the palette
// runs the same statusFromStore + statusLines as `kinas status` — one command, two doors, no second formatter.

import { SCHEMA_VERSION } from "@kinas/store/schema-version";
import type { HostRow, QuotaRow, ReaderRow, StorageAdapter, UsageRow } from "@kinas/store/types";
import type { UsageSnapshot } from "../api.ts";

export function snapshotAdapter(s: UsageSnapshot): StorageAdapter {
  return {
    schemaVersion: () => SCHEMA_VERSION,
    getQuotas: (): QuotaRow[] =>
      s.quotas.map((q) => ({
        subscription: q.subscription,
        window: q.window,
        used_pct: q.used_pct,
        resets_at: q.resets_at,
        plan: q.plan,
        source: q.source,
        updated_at: q.updated_at,
        models: q.models,
      })),
    getReaderStatus: (): ReaderRow[] => s.readers.map((r) => ({ ...r })),
    getHost: (): HostRow | null =>
      s.host && {
        machine: s.host.machine,
        cpu_pct: s.host.cpu_pct,
        mem_used_gb: s.host.mem_used_gb,
        mem_total_gb: s.host.mem_total_gb,
        disk_used_gb: s.host.disk_used_gb,
        disk_total_gb: s.host.disk_total_gb,
        disk_available_gb: s.host.disk_available_gb,
        updated_at: s.host.updated_at,
      },
    getUsageDaily: (date: string): UsageRow[] => s.usage.filter((u) => u.date === date).map((u) => ({ ...u })),
  };
}
