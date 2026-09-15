import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
