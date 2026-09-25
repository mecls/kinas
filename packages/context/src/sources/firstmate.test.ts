import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
    const crew = await crewFromSnapshot(snapshotFor(h), Date.now());
    expect(crew.schema).toBe("fm-fleet-snapshot.v1");
    expect(crew.in_flight).toEqual([{ id: "t-101", title: "Add login rate limiting", project: "acme", kind: "ship", state: "working", worktree: "/ops/clients/acme-t-101" }]);
    expect(crew.intake).toEqual([{ id: "t-103", title: "Write the onboarding email", repo: "hub", filed: "2026-09-14" }]);
    expect(crew.blocked).toEqual([{ id: "t-102", title: "Pick a payments provider", reason: "Stripe or Adyen: the report is in" }]);
    expect(crew.reports).toEqual([expect.objectContaining({ id: "t-095", first_line: "Payments providers compared" })]);
  });

  test("a task with a pending decision event is blocked too, once", async () => {
    const snap = snapshotFor(join(base, "pending")) as { tasks: { hints: { pending_decision: boolean; last_event_text: string } }[] };
    snap.tasks[0]!.hints.pending_decision = true;
    snap.tasks[0]!.hints.last_event_text = "decision: which rate?";
    const crew = await crewFromSnapshot(snap, Date.now());
    expect(crew.blocked.map((b) => [b.id, b.reason])).toEqual([
      ["t-102", "Stripe or Adyen: the report is in"],
      ["t-101", "decision: which rate?"],
    ]);
  });

  test("another contract version is refused by name", async () => {
    await expect(crewFromSnapshot({ schema: "fm-fleet-snapshot.v2" }, 0)).rejects.toThrow("unsupported snapshot contract fm-fleet-snapshot.v2");
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
