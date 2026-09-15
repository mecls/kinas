import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { activityEvents } from "./activity.ts";
import { briefPreamble } from "./brief.ts";
import { ContextCache } from "./cache.ts";
import { loadConfig } from "./config.ts";
import type { Crew, Packet, Section } from "./packet.ts";
import { computePacket } from "./refresh.ts";
import { AGENT_HEADINGS, nestHeadings, renderAgentPacket, stateCell } from "./render-agent.ts";
import { makeWorld, write, type World } from "./testing/world.ts";

let world: World;
let packet: Packet;
let markdown: string;

beforeAll(async () => {
  world = await makeWorld();
  const cache = ContextCache.open(world.dataDir);
  packet = await computePacket(loadConfig(world.env), cache);
  cache.close();
  markdown = renderAgentPacket(packet);
});
afterAll(() => world.cleanup());

/** The packet's own heading lines, in order — exactly what a hook or a brief looks for. */
const headings = (md: string) => md.split("\n").filter((l) => (AGENT_HEADINGS as readonly string[]).includes(l));

describe("the context packet", () => {
  test("has every section in its stable order, stable prefix first", () => {
    expect(headings(markdown)).toEqual([...AGENT_HEADINGS]);
  });

  test("reads every source in the world", () => {
    expect(packet.instance).toMatchObject({ org: "Acme Ops", instance: "operations", harness: "claude" });
    expect(packet.projects.data.map((p) => [p.name, p.branch, p.dirty, p.artifacts])).toEqual([
      ["acme", "main", 2, 3],
      ["hub", "main", 0, 2],
    ]);
    expect(packet.artifacts.data.filter((a) => a.project === "acme").map((a) => [a.path, a.title])).toEqual([
      ["README.md", "Acme storefront"],
      ["docs/plan.md", "Launch plan"],
      ["src/spec-auth.md", "Auth spec"],
    ]);
    expect(packet.conventions.data.map((c) => c.path)).toEqual(["AGENTS.md", "conventions/con-commits.md"]);
    expect(packet.crew.state).toBe("ok");
    expect(packet.sessions.data?.rows.map((r) => r.project)).toEqual(["acme", "hub"]);
    expect(packet.decisions.data).toEqual([{ source: "crew", id: "t-102", title: "Pick a payments provider", reason: "Stripe or Adyen: the report is in" }]);
    expect(packet.quotas.data.map((q) => [q.provider, q.window, q.left_pct, q.state])).toEqual([
      ["Claude", "session", 60, "fresh"],
      ["Codex", "5h", 70, "fresh"],
      ["Codex", "week", 87, "fresh"],
      ["Ollama", "session", 90, "fresh"],
    ]);
    expect(packet.recent.data.map((r) => [r.kind, r.project, r.text])).toEqual(
      expect.arrayContaining([
        ["commit", "acme", "Storefront skeleton"],
        ["commit", "hub", "Hub rules"],
      ]),
    );
  });

  test("answers what is in progress, what is blocked and which conventions apply, without opening a file", () => {
    expect(markdown).toContain("`t-101` Add login rate limiting — acme · ship · working · worktree ");
    expect(markdown).toContain("Crew task `t-102`: Pick a payments provider — Stripe or Adyen: the report is in");
    expect(markdown).toContain("Every change ships with a test.");
    expect(markdown).toContain("Say why, not what.");
    expect(markdown).toContain("Payments providers compared");
  });

  test("a convention's own headings sit below the packet's; fenced lines are untouched", () => {
    expect(markdown).toContain("#### Org rules");
    expect(markdown).toContain("##### Crew");
    expect(markdown).toContain("```md\n# not a heading\n```");
    expect(nestHeadings("# A\n~~~\n## B\n~~~\n###### C")).toBe("#### A\n~~~\n## B\n~~~\n###### C");
  });

  test("a brief starts on the rails: Conventions, then Projects", () => {
    const preamble = briefPreamble(packet);
    expect(headings(preamble)).toEqual(["## Conventions", "## Projects"]);
  });

  test("a quota note that already names its state does not repeat it", () => {
    expect(stateCell("not connected", "not connected — add the Claude Code hook in Settings")).toBe("not connected — add the Claude Code hook in Settings");
    expect(stateCell("not connected", "no Codex folder on this Mac")).toBe("not connected: no Codex folder on this Mac");
    expect(stateCell("fresh", null)).toBe("fresh");
  });

  test("a section that cannot be read is one line", () => {
    const gone: Packet = { ...packet, crew: { state: "unavailable", note: "firstmate: not installed", at: 0, data: null } };
    const section = renderAgentPacket(gone).split("\n## Crew\n\n")[1]!.split("\n\n")[0];
    expect(section).toBe("_Unavailable: firstmate: not installed._");
  });
});

describe("recent activity", () => {
  const crew = (data: Partial<Crew>): Section<Crew | null> => ({
    state: "ok",
    note: null,
    at: data.generated ? Date.parse(data.generated) : 1,
    data: { home: "/fm", schema: "fm-fleet-snapshot.v1", generated: "", in_flight: [], intake: [], blocked: [], reports: [], ...data },
  });

  test("crew state changes, new holds and filed briefs, compared with the packet before", () => {
    const task = { id: "t-1", title: "Ship it", project: "acme", kind: "ship", worktree: null };
    const prev = { ...packet, crew: crew({ generated: "2026-09-14T10:00:00Z", in_flight: [{ ...task, state: "working" }] }) } as Packet;
    const next = crew({
      generated: "2026-09-14T11:00:00Z",
      in_flight: [{ ...task, state: "review" }],
      blocked: [{ id: "t-2", title: "Choose", reason: null }],
      intake: [{ id: "t-3", title: "New brief", repo: "hub", filed: null }],
    });
    const events = activityEvents(prev, { projects: [], commits: new Map(), artifacts: prev.artifacts, crew: next, sessions: packet.sessions }, 99);
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ["crew", "Ship it: working → review"],
      ["crew", "Choose is waiting on a decision"],
      ["brief", "brief filed: New brief"],
    ]);
  });

  test("an artifact written while an agent works in its project names the agent", async () => {
    const plan = join(world.acme, "docs/plan.md");
    write(plan, "# Launch plan v2\n");
    const later = { ...packet, artifacts: { ...packet.artifacts, data: packet.artifacts.data.map((a) => (a.path === "docs/plan.md" ? { ...a, modified_at: a.modified_at + 5_000 } : a)) } };
    const events = activityEvents(packet, { projects: [], commits: new Map(), artifacts: later.artifacts, crew: packet.crew, sessions: packet.sessions }, 99);
    expect(events.map((e) => [e.kind, e.project, e.text])).toEqual([["file", "acme", "docs/plan.md written by claude"]]);
    rmSync(plan);
  });
});
