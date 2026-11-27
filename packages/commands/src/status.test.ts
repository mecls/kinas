import { describe, expect, test } from "bun:test";
import type { StatusResult, StatusQuota } from "./status.ts";
import type { StorageAdapter } from "@kinas/store/types";
import { statusFromStore, statusJson, statusLines } from "./status.ts";

const NOW = 1_790_000_000_000;

const usage = (tokens_in: number, tokens_cache_read: number, tokens_out: number) => ({
  date: "2026-09-14",
  harness: "claude-code" as const,
  provider: "anthropic",
  model: "claude-opus-5",
  tokens_in,
  tokens_cache_read,
  tokens_out,
  messages: 1,
});

const result = (usageToday: StatusResult["usageToday"]): StatusResult => ({ now: NOW, quotas: [] as StatusQuota[], missing: [], usageToday, host: null, linux_host: null });

const todayLine = (r: StatusResult) => statusLines(r, false).find((l) => l.startsWith("  claude-code"))!;

describe("kinas status's compact token counts", () => {
  test("950 · 34k · 1.3M · 6.1B — the Usage page's own numbers (README: the Usage page as text), from the one shared rule", () => {
    expect(todayLine(result([usage(950, 34_000, 1_250_000)]))).toBe("  claude-code · claude-opus-5     in 950 · cache 34k · out 1.3M · 1 msg");
    // Three significant figures as the page shows them: 150,400 is 150k and 999,600 is 1M here too, not 150.4k and 999.6k.
    expect(todayLine(result([usage(6_130_000_000, 150_400, 999_600)]))).toContain("in 6.1B · cache 150k · out 1M");
  });

  test("a count that rounds to a unit's ceiling moves up a unit, as the Usage page's compactTokens does: never 1000k or 1000M", () => {
    expect(todayLine(result([usage(999_950, 999_999, 999_950_000)]))).toContain("in 1M · cache 1M · out 1B");
    expect(todayLine(result([usage(1_000_000, 1_000, 1_000_000_000)]))).toContain("in 1M · cache 1k · out 1B");
  });
});

describe("statusFromStore judges a reading at the moment it is read", () => {
  test("a reading the app writes while the store is read is fresh, not a stamp from before a clock step", () => {
    // The app is another process with no guard the CLI shares: a sample it stamps just after the caller looked at the
    // clock, and commits before the rows are read, is newer than that look with no clock step behind it. The clock is
    // read once the rows are, so no row it judges is stamped after it unless the wall clock stepped back.
    let clock = NOW;
    const landed = NOW + 3;
    const store: StorageAdapter = {
      schemaVersion: () => 6,
      getReaderStatus: () => [],
      getQuotas: () => {
        clock = landed;
        return [{ subscription: "claude-plan", window: "session", used_pct: 40, resets_at: NOW + 3_600_000, plan: null, source: "s", updated_at: landed, models: [] }];
      },
      getHost: () => ({ machine: "mac-9c2e", cpu_pct: 1, mem_used_gb: 1, mem_total_gb: 2, disk_used_gb: 1, disk_total_gb: 2, disk_available_gb: null, updated_at: landed }),
      getUsageDaily: () => [],
    } as unknown as StorageAdapter;
    const r = statusFromStore(store, () => clock);
    expect([r.now, r.quotas[0]!.state, r.host!.state]).toEqual([landed, "fresh", "fresh"]);
    // A number is still a moment, as the palette passes the app's snapshot's.
    expect(statusFromStore(store, NOW).quotas[0]!.state).toBe("stale");
  });
});

describe("This Mac in kinas status", () => {
  const host = (age: number) =>
    statusLines(
      statusFromStore(
        {
          schemaVersion: () => 6,
          getReaderStatus: () => [],
          getQuotas: () => [],
          getHost: () => ({ machine: "mac-9c2e", cpu_pct: 12.4, mem_used_gb: 7.2, mem_total_gb: 16, disk_used_gb: 200, disk_total_gb: 460, disk_available_gb: 280, updated_at: NOW - age }),
          getUsageDaily: () => [],
        } as unknown as StorageAdapter,
        NOW,
      ),
      false,
    ).find((l) => l.startsWith("This Mac"))!;

  test("a reading past its dead limit shows no numbers as current, as the Usage page shows it: a dash where each reading was", () => {
    // The app quit overnight: the last sample is 13 hours old, past the host reader's 12. Stale is marked; dead is older
    // still, and printed as it was it would read as this Mac now.
    expect(host(13 * 3_600_000)).toMatch(/^This Mac {11}CPU — · memory —\/16\.0 GiB · disk available — · as of (?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}$/);
    expect(host(5 * 60_000)).toMatch(/^This Mac {11}CPU 12% · memory 7\.2\/16\.0 GiB · disk available 300 GB · as of \d{2}:\d{2} \(stale\)$/);
    expect(host(30_000)).toMatch(/^This Mac {11}CPU 12% · memory 7\.2\/16\.0 GiB · disk available 300 GB · as of \d{2}:\d{2}$/);
  });
});

describe("the Linux machine in kinas status (slice 5.2)", () => {
  const store = (linux: boolean) =>
    ({
      schemaVersion: () => 10,
      getReaderStatus: () => [],
      getQuotas: () => [],
      getHost: () => ({ machine: "mac-9c2e", cpu_pct: 12.4, mem_used_gb: 7.2, mem_total_gb: 16, disk_used_gb: 200, disk_total_gb: 460, disk_available_gb: 280, updated_at: NOW - 5_000 }),
      getLinuxHost: () => (linux ? { machine: "homelab", cpu_pct: null, mem_used_gb: 3, mem_total_gb: 16, disk_used_gb: 40, disk_total_gb: 200, disk_available_gb: 150, updated_at: NOW - 5_000 } : null),
      getUsageDaily: () => [],
    }) as unknown as StorageAdapter;

  test("a line under This Mac named for the label, with a dash for CPU until there are two samples; none without it", () => {
    const lines = statusLines(statusFromStore(store(true), NOW), false);
    const mac = lines.findIndex((l) => l.startsWith("This Mac"));
    expect(lines[mac + 1]).toMatch(/^Linux machine · homelab CPU — · memory 3\.0\/16\.0 GiB · disk available 161 GB · as of /);
    expect(statusJson(statusFromStore(store(true), NOW)).linux_host).toMatchObject({ machine: "homelab", cpu_pct: null, state: "fresh" });
    expect(statusLines(statusFromStore(store(false), NOW), false).some((l) => l.startsWith("Linux machine"))).toBe(false);
    expect(statusJson(statusFromStore(store(false), NOW)).linux_host).toBeNull();
  });
});
