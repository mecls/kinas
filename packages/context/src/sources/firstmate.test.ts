import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceError, SourceTimeout } from "../source.ts";
import { fixture, write } from "../testing/world.ts";
import { crewEnv, crewFromSnapshot, readCrew } from "./firstmate.ts";

const base = mkdtempSync(join(tmpdir(), "kinas-fm-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

function home(name: string, script: string): string {
  const h = join(base, name);
  write(join(h, "bin/fm-fleet-snapshot.sh"), script);
  chmodSync(join(h, "bin/fm-fleet-snapshot.sh"), 0o755);
  mkdirSync(join(h, "state"), { recursive: true });
  return h;
}

function snapshotFor(h: string): unknown {
  write(join(h, "data/t-095/report.md"), "\n# Payments providers compared\n\nbody\n");
  return JSON.parse(fixture("firstmate-fleet-snapshot.synthetic.json").replaceAll("__FM_HOME__", h).replaceAll("__ROOT__", "/ops"));
}

describe("the crew from Firstmate's fleet snapshot", () => {
  test("in flight with worktrees, open briefs, holds waiting on the captain, and the last reports", async () => {
    const h = join(base, "map");
    const crew = await crewFromSnapshot(snapshotFor(h), Date.now(), h);
    expect(crew.schema).toBe("fm-fleet-snapshot.v1");
    expect(crew.in_flight).toEqual([{ id: "t-101", title: "Add login rate limiting", project: "acme", kind: "ship", state: "working", worktree: "/ops/clients/acme-t-101" }]);
    expect(crew.intake).toEqual([{ id: "t-103", title: "Write the onboarding email", repo: "hub", filed: "2026-09-14" }]);
    expect(crew.blocked).toEqual([{ id: "t-102", title: "Pick a payments provider", reason: "Stripe or Adyen: the report is in" }]);
    expect(crew.reports).toEqual([expect.objectContaining({ id: "t-095", first_line: "Payments providers compared" })]);
  });

  test("a task with a pending decision event is blocked too, once", async () => {
    const pending = join(base, "pending");
    const snap = snapshotFor(pending) as { tasks: { hints: { pending_decision: boolean; last_event_text: string } }[] };
    snap.tasks[0]!.hints.pending_decision = true;
    snap.tasks[0]!.hints.last_event_text = "decision: which rate?";
    const crew = await crewFromSnapshot(snap, Date.now(), pending);
    expect(crew.blocked.map((b) => [b.id, b.reason])).toEqual([
      ["t-102", "Stripe or Adyen: the report is in"],
      ["t-101", "decision: which rate?"],
    ]);
  });

  test("a scout report outside Firstmate's home is not read, however its path is written", async () => {
    // ADR 0019: under the home Kinas reads a report's first line, and nothing outside it (crew/mod.rs `under_home`).
    const h = join(base, "reports", "firstmate");
    const snap = snapshotFor(h) as { scout_reports: { id: string; path: string }[] };
    write(join(base, "reports", "secret.md"), "TOKEN=not-for-the-packet-9c2e\n");
    snap.scout_reports.push({ id: "abs-9c2e", path: join(base, "reports", "secret.md") }, { id: "up-9c2e", path: `${h}/data/../../secret.md` });
    const crew = await crewFromSnapshot(snap, Date.now(), h);
    expect(crew.reports.map((r) => r.id)).toEqual(["t-095"]);
  });

  test("a report under the home that is a link to a file outside it is not read; a home reached through a link is", async () => {
    // ADR 0019 again: the path is lexically inside the home, and the file it opens is not. The app opens a report only
    // through the reader, which judges the real path; the packet read the link's target, whatever a worker linked.
    const h = join(base, "linked", "firstmate");
    const snap = snapshotFor(h) as { scout_reports: { id: string; path: string }[] };
    write(join(base, "linked", "secret.md"), "TOKEN=not-for-the-packet-9c2e\n");
    mkdirSync(join(h, "data", "t-777"), { recursive: true });
    symlinkSync(join(base, "linked", "secret.md"), join(h, "data", "t-777", "report.md"));
    snap.scout_reports.push({ id: "t-777", path: "data/t-777/report.md" });
    expect((await crewFromSnapshot(snap, Date.now(), h)).reports.map((r) => r.id)).toEqual(["t-095"]);
    // FM_HOME may itself be a link to the clone: its reports are inside it, as written.
    const link = join(base, "linked", "fm-link");
    symlinkSync(h, link);
    const viaLink = JSON.parse(JSON.stringify(snap).replaceAll(h, link));
    expect((await crewFromSnapshot(viaLink, Date.now(), link)).reports.map((r) => [r.id, r.first_line])).toEqual([["t-095", "Payments providers compared"]]);
  });

  test("another contract version is refused by name", async () => {
    await expect(crewFromSnapshot({ schema: "fm-fleet-snapshot.v2" }, 0, base)).rejects.toThrow("unsupported snapshot contract fm-fleet-snapshot.v2");
  });

  test("runs the snapshot script with FM_HOME and reads its JSON", async () => {
    const h = home("run", '#!/bin/sh\ncat "$FM_HOME/snapshot.json"\n');
    write(join(h, "snapshot.json"), JSON.stringify(snapshotFor(h)));
    expect((await readCrew(h, Date.now())).in_flight).toHaveLength(1);
  });

  test("not installed, no state, a failing script and a slow one are each one line", async () => {
    await expect(readCrew(join(base, "absent"), 0)).rejects.toThrow(/^firstmate: not installed/);

    const empty = join(base, "empty");
    write(join(empty, "bin/fm-fleet-snapshot.sh"), "#!/bin/sh\n");
    await expect(readCrew(empty, 0)).rejects.toThrow(`firstmate: no fleet state yet in ${empty}`);

    const failing = home("failing", '#!/bin/sh\necho "jq not found" >&2\nexit 1\n');
    await expect(readCrew(failing, 0)).rejects.toThrow("firstmate: the fleet snapshot failed (jq not found)");

    const slow = home("slow", "#!/bin/sh\nsleep 5\n");
    const error = await readCrew(slow, 0, 200).catch((e) => e);
    expect(error).toBeInstanceOf(SourceTimeout);
    expect(error).not.toBeInstanceOf(SourceError);
  });
});

test("a crew process gets FM_HOME and none of Herdr's variables (PRD rule 29)", () => {
  const env = crewEnv({ PATH: "/usr/bin", HOME: "/h", HERDR_SESSION: "default", HERDR_PANE_ID: "w1:p1", herdr_env: "1", FM_HOME: "/elsewhere" }, "/h/firstmate");
  expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h", FM_HOME: "/h/firstmate" });
});

test("a scout report that is not a regular file is never opened, from the snapshot or the mirror: the packet does not wait", () => {
  // A worker writes its report where Firstmate's records say; a FIFO at that path, inside the home, passed every check
  // (lexically and really under the home, and it stats), and its first line was read: that read never returned, and no
  // deadline covers the reports, so `kinas context`, every refresh and every session hook waited for good. Run in a
  // child, so the failure is a timeout and not this process stuck.
  const h = join(base, "fifo-report", "firstmate");
  const snap = snapshotFor(h) as { scout_reports: { id: string; path: string }[] };
  mkdirSync(join(h, "data", "t-fifo-9c2e"), { recursive: true });
  expect(Bun.spawnSync(["mkfifo", join(h, "data", "t-fifo-9c2e", "report.md")]).exitCode).toBe(0);
  snap.scout_reports.push({ id: "t-fifo-9c2e", path: "data/t-fifo-9c2e/report.md" });
  const status = { reader: "crew", state: "ok", last_attempt_at: Date.now(), last_success_at: Date.now(), last_error: null, stale_after_ms: 180_000, dead_after_ms: 43_200_000 };
  const scout = (id: string) => ({ id, title: id, project: null, project_name: "p-9c2e", kind: "scout", backlog_state: "done", state: null, worktree_path: null, report_path: `data/${id}/report.md`, report_present: 1, captain_actionable: 0, snapshot_generated: "2026-09-25T09:00:00Z", done_at: Date.now() - 1_000, gone_at: null });
  const code = `const { crewFromSnapshot } = await import(${JSON.stringify(join(import.meta.dir, "firstmate.ts"))});
    const { crewFromStore } = await import(${JSON.stringify(join(import.meta.dir, "mirror.ts"))});
    const fromSnapshot = await crewFromSnapshot(${JSON.stringify(snap)}, Date.now(), ${JSON.stringify(h)});
    const store = { getReaderStatus: () => [${JSON.stringify(status)}], getCrewMirror: () => [${JSON.stringify(scout("t-095"))}, ${JSON.stringify(scout("t-fifo-9c2e"))}], getCrewDecisions: () => [] };
    const fromMirror = await crewFromStore(store, Date.now(), ${JSON.stringify(h)});
    process.stdout.write(JSON.stringify([fromSnapshot, fromMirror].map((c) => c.reports.map((r) => [r.id, r.first_line]))));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual([[["t-095", "Payments providers compared"]], [["t-095", "Payments providers compared"]]]);
}, 30_000);
