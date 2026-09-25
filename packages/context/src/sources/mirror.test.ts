import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrewDecisionRow, CrewMirrorRow, ReaderRow } from "@kinas/store/types";
import { crewFromStore, MIRROR_FRESH_MS } from "./mirror.ts";

// The Crew section from the app's mirror (build spec §11.4 mirror.test.ts): a fresh mirror is used; a six-minute-old one
// is not; no crew rows at all is null; the same fields as the snapshot gives.

const NOW = 1_790_000_000_000;
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const status = (lastSuccess: number | null): ReaderRow => ({
  reader: "crew",
  state: "ok",
  last_attempt_at: lastSuccess,
  last_success_at: lastSuccess,
  last_error: null,
  stale_after_ms: 180_000,
  dead_after_ms: 43_200_000,
});

const row = (id: string, extra: Partial<CrewMirrorRow> = {}): CrewMirrorRow => ({
  id,
  title: `${id} title`,
  project: `/h/projects/p-9c2e`,
  project_name: "p-9c2e",
  kind: "ship",
  backlog_state: "in_flight",
  state: "working",
  worktree_path: "/t/1",
  report_path: null,
  report_present: 0,
  captain_actionable: 0,
  snapshot_generated: "2026-09-25T09:00:00Z",
  done_at: null,
  gone_at: null,
  ...extra,
});

const store = (lastSuccess: number | null, rows: CrewMirrorRow[], decisions: CrewDecisionRow[] = []) => ({
  getReaderStatus: () => (lastSuccess === null ? [] : [status(lastSuccess)]),
  getCrewMirror: () => rows,
  getCrewDecisions: () => decisions,
});

test("a fresh mirror stands for the fleet", async () => {
  const home = mkdtempSync(join(tmpdir(), "kinas-mirror-"));
  roots.push(home);
  mkdirSync(join(home, "data", "s-9c2e"), { recursive: true });
  writeFileSync(join(home, "data", "s-9c2e", "report.md"), "# Slowest pages 9c2e\n\nbody");
  const crew = await crewFromStore(
    store(NOW - 60_000, [
      row("a-9c2e"),
      row("q-9c2e", { backlog_state: "queued", state: null, project: null }),
      row("h-9c2e", { captain_actionable: 1 }),
      row("s-9c2e", { kind: "scout", backlog_state: "done", state: null, done_at: NOW - 1_000, report_path: "data/s-9c2e/report.md", report_present: 1 }),
      row("g-9c2e", { gone_at: NOW - 1_000 }),
    ], [
      { task_id: "h-9c2e", verb: "captain-hold", summary: "Land it? 9c2e", task_title: "h-9c2e title" },
      { task_id: "a-9c2e", verb: "needs-decision", summary: "REST? 9c2e", task_title: "a-9c2e title" },
      { task_id: "a-9c2e", verb: "needs-decision", summary: "again", task_title: "a-9c2e title" },
    ]),
    NOW,
    home,
  );
  expect(crew!.in_flight.map((t) => t.id)).toEqual(["a-9c2e", "h-9c2e"]);
  expect(crew!.in_flight[0]).toEqual({ id: "a-9c2e", title: "a-9c2e title", project: "/h/projects/p-9c2e", kind: "ship", state: "working", worktree: "/t/1" });
  expect(crew!.intake).toEqual([{ id: "q-9c2e", title: "q-9c2e title", repo: "p-9c2e", filed: null }]);
  expect(crew!.blocked).toEqual([
    { id: "h-9c2e", title: "h-9c2e title", reason: "Land it? 9c2e" },
    { id: "a-9c2e", title: "a-9c2e title", reason: "REST? 9c2e" },
  ]);
  expect(crew!.reports.map((r) => [r.id, r.first_line])).toEqual([["s-9c2e", "Slowest pages 9c2e"]]);
  expect(crew!.schema).toBe("fm-fleet-snapshot.v1");
});

test("a mirror six minutes old, or never written, stands for nothing", async () => {
  expect(await crewFromStore(store(NOW - MIRROR_FRESH_MS - 60_000, [row("a-9c2e")]), NOW, "/h")).toBeNull();
  expect(await crewFromStore(store(null, [row("a-9c2e")]), NOW, "/h")).toBeNull();
});
