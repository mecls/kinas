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
    getHost: (): HostRow | null => s.host && hostRow(s.host),
    getLinuxHost: (): HostRow | null => s.linux_host && hostRow(s.linux_host),
    getUsageDaily: (date: string): UsageRow[] => s.usage.filter((u) => u.date === date).map((u) => ({ ...u })),
  };
}

/** The snapshot's view of a machine as the store's row: the state is the status code's to judge again. */
function hostRow(h: NonNullable<UsageSnapshot["host"]>): HostRow {
  return {
    machine: h.machine,
    cpu_pct: h.cpu_pct,
    mem_used_gb: h.mem_used_gb,
    mem_total_gb: h.mem_total_gb,
    disk_used_gb: h.disk_used_gb,
    disk_total_gb: h.disk_total_gb,
    disk_available_gb: h.disk_available_gb,
    updated_at: h.updated_at,
  };
}
