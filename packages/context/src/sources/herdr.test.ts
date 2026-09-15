import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHerdr, fixture } from "../testing/world.ts";
import { herdrSnapshot, projectFor, readSessions, sessionsFromSnapshot } from "./herdr.ts";

const base = mkdtempSync(join(tmpdir(), "kinas-h-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const ROOT = "/ops";
const projects = [
  { name: "acme", path: "/ops/clients/acme" },
  { name: "hub", path: "/ops/hub" },
];
const answer = () => JSON.parse(fixture("herdr-snapshot.synthetic.json").replaceAll("__ROOT__", ROOT));

describe("Herdr sessions", () => {
  test("agents become sessions with their workspace and project, blocked first", () => {
    const snap = answer();
    snap.result.snapshot.agents.push({ agent: "codex", agent_status: "blocked", cwd: "/elsewhere", pane_id: "w1:p3", workspace_id: "w1", terminal_title_stripped: "Needs approval" });
    const sessions = sessionsFromSnapshot(snap, projects);
    expect(sessions.server).toBe("0.9.0");
    expect(sessions.rows.map((r) => [r.status, r.agent, r.workspace, r.project, r.title])).toEqual([
      ["blocked", "codex", "acme", null, "Needs approval"],
      ["working", "claude", "acme", "acme", "Rate limiting"],
      ["idle", "pi", "acme", "hub", "Conventions review"],
    ]);
  });

  test("the deepest project folder holding a directory wins", () => {
    expect(projectFor("/ops/clients/acme/src", [...projects, { name: "clients", path: "/ops/clients" }])).toBe("acme");
    expect(projectFor("/ops/clients/acmeish", projects)).toBeNull();
    expect(projectFor(null, projects)).toBeNull();
  });

  test("over the socket: one request, one answer", async () => {
    const herdr = new FakeHerdr(join(base, "ok.sock"), fixture("herdr-snapshot.synthetic.json").replaceAll("__ROOT__", ROOT));
    await herdr.start();
    try {
      expect((await readSessions(herdr.socket, projects)).rows).toHaveLength(2);
    } finally {
      await herdr.stop();
    }
  });

  test("no socket is 'herdr: not running'", async () => {
    await expect(herdrSnapshot(join(base, "none.sock"))).rejects.toThrow("herdr: not running");
  });

  test("a socket that never answers gives up at the deadline", async () => {
    const herdr = new FakeHerdr(join(base, "silent.sock"), "{}");
    herdr.silent = true;
    await herdr.start();
    try {
      const t0 = performance.now();
      await expect(herdrSnapshot(herdr.socket, 150)).rejects.toThrow("herdr: not answering");
      expect(performance.now() - t0).toBeLessThan(1_000);
    } finally {
      await herdr.stop();
    }
  });

  test("an error answer or an unknown shape is one line", () => {
    expect(() => sessionsFromSnapshot({ id: "x", error: { message: "unsupported protocol" } }, projects)).toThrow("herdr: unsupported protocol");
    expect(() => sessionsFromSnapshot({ result: {} }, projects)).toThrow("herdr: unexpected snapshot shape");
  });
});
