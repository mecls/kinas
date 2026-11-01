import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { write } from "../testing/world.ts";
import { codexQuotas, codexWindows, freshness, storeQuotas } from "./quotas.ts";

const base = mkdtempSync(join(tmpdir(), "kinas-q-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const NOW = Date.parse("2026-09-14T21:00:00Z");
const line = (at: number, limits: unknown) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: "event_msg", payload: { type: "token_count", rate_limits: limits } });

describe("quotas", () => {
  test("a fresh reading older than fifteen minutes is stale; other states stand", () => {
    expect(freshness("fresh", NOW - 14 * 60_000, NOW)).toBe("fresh");
    expect(freshness("fresh", NOW - 16 * 60_000, NOW)).toBe("stale");
    expect(freshness("dead", NOW - 60 * 60_000, NOW)).toBe("dead");
  });

  test("Codex windows from a token_count event: left floored, resets absolute or relative", () => {
    const windows = codexWindows(
      line(NOW - 60_000, {
        primary: { used_percent: 30.5, window_minutes: 300, resets_at: NOW / 1000 + 3600 },
        secondary: { used_percent: 12, window_minutes: 10080, resets_in_seconds: 86_400 },
      }),
      NOW,
    );
    expect(windows).toEqual([
      { provider: "Codex", window: "5h", left_pct: 69, resets_at: NOW + 3_600_000, updated_at: NOW - 60_000, state: "fresh", note: null },
      { provider: "Codex", window: "week", left_pct: 88, resets_at: NOW - 60_000 + 86_400_000, updated_at: NOW - 60_000, state: "fresh", note: null },
    ]);
  });

  test("an old Codex reading is stale and an ended window is reset", () => {
    const [stale] = codexWindows(line(NOW - 20 * 60_000, { primary: { used_percent: 1, window_minutes: 300, resets_at: NOW / 1000 + 60 } }), NOW)!;
    expect(stale!.state).toBe("stale");
    const [reset] = codexWindows(line(NOW - 60_000, { primary: { used_percent: 99, window_minutes: 300, resets_at: NOW / 1000 - 1 } }), NOW)!;
    expect(reset!.state).toBe("reset");
    expect(codexWindows('{"type":"other"}', NOW)).toBeNull();
    expect(codexWindows("not json rate_limits", NOW)).toBeNull();
  });

  test("the newest Codex session with a reading wins; none is one honest line", async () => {
    const home = join(base, "codex");
    write(join(home, "sessions/2026/09/13/rollout-2026-09-13T10-00-00-a.jsonl"), `${line(NOW - 86_400_000, { primary: { used_percent: 50, window_minutes: 300 } })}\n`);
    write(join(home, "sessions/2026/09/14/rollout-2026-09-14T10-00-00-b.jsonl"), `${line(NOW - 60_000, { primary: { used_percent: 20, window_minutes: 300 } })}\n{"type":"noise"}\n`);
    expect((await codexQuotas(home, NOW)).map((q) => q.left_pct)).toEqual([80]);

    expect(await codexQuotas(join(base, "nope"), NOW)).toEqual([expect.objectContaining({ provider: "Codex", state: "not_connected", note: "no Codex folder on this Mac" })]);
    const quiet = join(base, "quiet");
    write(join(quiet, "sessions/2026/09/14/rollout-x.jsonl"), '{"type":"noise"}\n');
    expect((await codexQuotas(quiet, NOW))[0]!.note).toBe("no rate-limit reading in recent Codex sessions");
  });

  test("without the app's store, Claude and Ollama say why", () => {
    expect(storeQuotas({ ok: false, note: "the Kinas app has not run yet" }, NOW).map((q) => [q.provider, q.state, q.note])).toEqual([
      ["Claude", "not_connected", "the Kinas app has not run yet"],
      ["Ollama", "not_connected", "the Kinas app has not run yet"],
    ]);
  });
});

test("a quota stamped after now is stale, as the store's staleness rule has it: the clock stepped back since", () => {
  const now = 1_790_000_000_000;
  expect(freshness("fresh", now + 2 * 3_600_000, now)).toBe("stale");
  expect(freshness("fresh", now - 60_000, now)).toBe("fresh");
});

test("the newest Codex reading wins, not the newest-named session: one still running beside a later one, or resumed", async () => {
  // Codex names a session's log for when it started and keeps writing it while the session runs, `codex resume`
  // included. A session started first and still working holds the reading of a minute ago; one started after it and
  // idle since holds an older one, under a later name.
  const home = join(base, "parallel");
  const active = join(home, "sessions/2026/09/14/rollout-2026-09-14T10-00-00-a.jsonl");
  const idle = join(home, "sessions/2026/09/14/rollout-2026-09-14T10-05-00-b.jsonl");
  write(active, `${line(NOW - 60_000, { primary: { used_percent: 40, window_minutes: 300 } })}\n`);
  write(idle, `${line(NOW - 50 * 60_000, { primary: { used_percent: 10, window_minutes: 300 } })}\n`);
  utimesSync(idle, new Date(NOW - 50 * 60_000), new Date(NOW - 50 * 60_000));
  expect((await codexQuotas(home, NOW)).map((q) => [q.left_pct, q.state])).toEqual([[60, "fresh"]]);

  // Resumed today, the session's log is still in the folder of the day it began, behind five later sessions.
  const resumed = join(base, "resumed");
  write(join(resumed, "sessions/2026/09/01/rollout-2026-09-01T09-00-00-r.jsonl"), `${line(NOW - 30_000, { primary: { used_percent: 70, window_minutes: 300 } })}\n`);
  for (let d = 2; d <= 7; d++) {
    const old = join(resumed, `sessions/2026/09/0${d}/rollout-2026-09-0${d}T09-00-00-x.jsonl`);
    write(old, `${line(NOW - 86_400_000, { primary: { used_percent: 5, window_minutes: 300 } })}\n`);
    utimesSync(old, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
  }
  expect((await codexQuotas(resumed, NOW)).map((q) => q.left_pct)).toEqual([30]);
});

test("a Codex log that is not a regular file is never opened: the reading still comes, and the packet does not wait", () => {
  // Codex's session logs are an agent's own folder. A FIFO there named like a rollout was the newest log (its mtime is
  // when it was made), and its read never returned: no deadline covers the Codex line, so `kinas context`, every
  // refresh and every session hook waited for good. Run in a child, so the failure is a timeout and not this process stuck.
  const home = join(base, "fifo");
  write(join(home, "sessions/2026/09/14/rollout-2026-09-14T10-00-00-a-9c2e.jsonl"), `${line(NOW - 60_000, { primary: { used_percent: 25, window_minutes: 300 } })}\n`);
  expect(Bun.spawnSync(["mkfifo", join(home, "sessions/2026/09/14/rollout-2026-09-14T11-00-00-fifo-9c2e.jsonl")]).exitCode).toBe(0);
  const code = `const { codexQuotas } = await import(${JSON.stringify(join(import.meta.dir, "quotas.ts"))});
    const lines = await codexQuotas(${JSON.stringify(home)}, ${NOW});
    process.stdout.write(JSON.stringify(lines.map((q) => [q.provider, q.left_pct])));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual([["Codex", 75]]);
}, 30_000);
