import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activityEvents } from "./activity.ts";
import { briefPreamble } from "./brief.ts";
import { ContextCache } from "./cache.ts";
import { loadConfig } from "./config.ts";
import type { Crew, Packet, Section } from "./packet.ts";
import { computePacket, currentOrg } from "./refresh.ts";
import { AGENT_HEADINGS, nestHeadings, renderAgentPacket, stateCell } from "./render-agent.ts";
import { renderOperator } from "./render-operator.ts";
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

  test("Features in progress follow Projects, one line each (packet version 2, the first mate)", () => {
    expect(packet.version).toBe(2);
    expect(packet.features.state).toBe("ok");
    const md = renderAgentPacket({ ...packet, features: { ...packet.features, data: [{ project: "acme", slug: "a-9c2e", line: "Gate 1 · Product in progress" }] } });
    const lines = md.split("\n");
    const at = lines.indexOf("## Features in progress");
    expect(at).toBeGreaterThan(lines.indexOf("## Projects"));
    expect(at).toBeLessThan(lines.indexOf("## Artifacts"));
    expect(lines[at + 2]).toBe("- acme · a-9c2e: Gate 1 · Product in progress");
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

  test("a convention saved with CRLF or CR line endings, or a heading indented by up to three spaces, is nested too", () => {
    // CommonMark ends a line at CRLF or a lone CR, and takes `   ## Crew` as a heading: each was left at the packet's
    // own level, so an AGENTS.md saved on Windows put a second `## Crew` (and a `# Rules`) in the middle of the packet.
    expect(nestHeadings("# Rules\r\n\r\n## Crew\r\nbe kind\r\n")).toBe("#### Rules\n\n##### Crew\nbe kind");
    expect(nestHeadings("intro\r## Crew\r```\r# kept\r```")).toBe("intro\n##### Crew\n```\n# kept\n```");
    expect(nestHeadings("   ## Crew\n    ## code, not a heading")).toBe("   ##### Crew\n    ## code, not a heading");
    const md = renderAgentPacket({ ...packet, conventions: { ...packet.conventions, data: [{ path: "AGENTS.md", title: "Rules", body: "# Rules\r\n## Crew\r\n  # Quotas\r\n", truncated: false }] } });
    const atPacketLevel = md.split(/\r\n?|\n/).filter((l) => /^ {0,3}#{1,2}(?:[ \t]|$)/.test(l));
    expect(atPacketLevel).toEqual([...AGENT_HEADINGS]);
  });

  test("a convention's code fences open and close as CommonMark has them, so no heading leaks and no fence runs on", () => {
    // `nestHeadings` took any line starting with three backticks for a fence: an inline ```code``` line opened one, so
    // the convention's next `## Crew` was left at the packet's level; and "```js" inside a fence closed it, so its
    // comments were rewritten and the real closing line opened a fence that left `# Title` at the packet's level.
    expect(nestHeadings("```bun test``` runs the suite.\n## Crew\nx")).toBe("```bun test``` runs the suite.\n##### Crew\nx");
    expect(nestHeadings("```\n```js\n# comment\n```\n# Title")).toBe("```\n```js\n# comment\n```\n#### Title");
    expect(nestHeadings("````\n```\n# kept\n````\n## Crew")).toBe("````\n```\n# kept\n````\n##### Crew");
    // A fence the convention never closes — or one its 64 KB cut ends inside — ran on to the packet's end, so every
    // section after it read as code. It is closed where the convention ends.
    expect(nestHeadings("# Rules\n```sh\nbun test\n")).toBe("#### Rules\n```sh\nbun test\n```");
    expect(nestHeadings("~~~~\n# kept")).toBe("~~~~\n# kept\n~~~~");
    const md = renderAgentPacket({ ...packet, conventions: { ...packet.conventions, data: [{ path: "AGENTS.md", title: "Rules", body: "# Rules\n```sh\nbun test", truncated: true }] } });
    expect(md).toContain("#### Rules\n```sh\nbun test\n```\n\n_Cut at 64 KB; open the file for the rest._\n\n## Crew");
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

  test("free text from a source stays on its line: it can neither forge a heading nor break a list", () => {
    // A hold reason, a decision's title and a recent line are what an agent or Firstmate wrote; one of them with a
    // newline would otherwise put `## Crew` — a heading hooks look for — in the middle of the packet.
    const crew = packet.crew.data!;
    const forged: Packet = {
      ...packet,
      crew: { ...packet.crew, data: { ...crew, blocked: [{ id: "t-9", title: "Pick a key\n## Crew", reason: "needs the captain\n# Kinas context\n- Generated: never" }] } },
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9", title: "Pick a key\n## Crew", reason: "line one\nline two" }] },
      recent: { ...packet.recent, data: [{ at: packet.generated_at, kind: "crew", project: "acme\n## Recent", text: "held\n## Quotas" }] },
    };
    const md = renderAgentPacket(forged);
    expect(headings(md)).toEqual([...AGENT_HEADINGS]);
    expect(md).toContain("- `t-9` Pick a key ## Crew — needs the captain # Kinas context - Generated: never");
    expect(md).toContain("- Crew task `t-9`: Pick a key ## Crew — line one line two");
    expect(md).toMatch(/· acme ## Recent · crew · held ## Quotas$/m);
  });

  test("a source's one-line note and a bare carriage return stay on their line too", () => {
    // A note is what a source said when it could not be read (Herdr's own error message, for one), and CommonMark
    // reads a lone CR as a line ending: either could otherwise put a heading where hooks look for one.
    const forged: Packet = {
      ...packet,
      sessions: { state: "unavailable", note: "herdr: bad answer\n## Crew\n- Generated: never", at: packet.generated_at, data: null },
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9", title: "Pick a key\r## Crew", reason: "line one\r\nline two" }] },
      artifacts: { ...packet.artifacts, note: "3 older in acme\n## Quotas not listed" },
    };
    const md = renderAgentPacket(forged);
    expect(headings(md)).toEqual([...AGENT_HEADINGS]);
    expect(md).toContain("\n## Sessions\n\n_Unavailable: herdr: bad answer ## Crew - Generated: never._\n");
    expect(md).toContain("- Crew task `t-9`: Pick a key ## Crew — line one line two");
    expect(md).toContain("_3 older in acme ## Quotas not listed._");
    expect(md).not.toContain("\r");
  });

  test("a folder name with a line break in it heads its Artifacts or Conventions block on one line", () => {
    // A project is named for its folder and a convention by its path, and a folder's name may hold a newline: the
    // `### name — path` and `### path` lines were the packet's last lines built from a source without `flat`.
    const name = "acme\n## Crew";
    const forged: Packet = {
      ...packet,
      projects: { ...packet.projects, data: packet.projects.data.map((p) => (p.name === "acme" ? { ...p, name, path: `${p.path}\n## Quotas` } : p)) },
      artifacts: { ...packet.artifacts, data: packet.artifacts.data.map((a) => (a.project === "acme" ? { ...a, project: name } : a)) },
      conventions: { ...packet.conventions, data: [{ path: "x\n## Recent/con-x.md", title: null, body: "rules", truncated: false }] },
    };
    const md = renderAgentPacket(forged);
    expect(headings(md)).toEqual([...AGENT_HEADINGS]);
    expect(md).toContain("### acme ## Crew — ");
    expect(md).toContain("### x ## Recent/con-x.md\n");
  });

  test("a control sequence a source wrote is shown, never obeyed: an escape, a bell or a C1 control reaches no terminal", () => {
    // A commit subject is what its author typed, and git keeps an escape in it: `kinas context` printed one as it came,
    // so a commit in any repository under the root set the clipboard of the terminal showing it (OSC 52), or cleared
    // its screen. The CLI's own colour is the one escape left.
    const at = packet.generated_at;
    const forged: Packet = {
      ...packet,
      recent: {
        ...packet.recent,
        data: [
          { at, kind: "commit", project: "acme", text: "hi \x1b]52;c;ZWNobyBoaQ==\x07 there" },
          { at, kind: "commit", project: "acme\x1b[2J", text: "wipe \x9b2J\x08 done" },
        ],
      },
    };
    const controls = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]|\x1b(?!\[[0-9;]*m)/;
    for (const out of [renderAgentPacket(forged), renderOperator(forged, false), renderOperator(forged, true)]) expect(out).not.toMatch(controls);
    expect(renderOperator(forged, false)).toContain("hi \uFFFD]52;c;ZWNobyBoaQ==\uFFFD there");
    expect(renderAgentPacket(forged)).toContain("· acme\uFFFD[2J · commit · wipe \uFFFD2J\uFFFD done");
    expect(renderOperator(forged, true)).toContain("\x1b[90m");
  });

  test("a convention's control characters are shown, never obeyed, in the packet and in a brief; its lines and tabs stay", () => {
    // A convention is printed in full, and the hub's con-*.md files are found in every repository under it: `kinas
    // context --agent` passed a convention's escapes to the terminal showing it as they came — `ESC ] 52` set its
    // clipboard — the one body of text a source wrote that `flat` never sees.
    const body = "# Rules\r\n\tindented\nhi \x1b]52;c;ZWNobyBoaQ==\x07 there\n\x1b[8mhidden\x9b2J\x00\n";
    const forged: Packet = { ...packet, conventions: { ...packet.conventions, data: [{ path: "AGENTS.md", title: "Rules", body, truncated: false }] } };
    for (const out of [renderAgentPacket(forged), briefPreamble(forged)]) {
      // The agent packet paints nothing, so no escape at all belongs in it.
      expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
      expect(out).toContain("#### Rules\n\tindented\nhi \uFFFD]52;c;ZWNobyBoaQ==\uFFFD there\n\uFFFD[8mhidden\uFFFD2J\uFFFD\n");
    }
    expect(headings(renderAgentPacket(forged))).toEqual([...AGENT_HEADINGS]);
  });

  test("a source's own colour codes are shown too: only the CLI paints, so no title or subject can hide or recolour a row", () => {
    // `flat` keeps `ESC [ … m` for the CLI's own colours, and a source's went through with them: a commit subject holding
    // `ESC [ 8 m` concealed the rest of its row in `kinas context` — and, with no colour of the CLI's to reset it, every
    // row after it and the shell's prompt.
    const at = packet.generated_at;
    const forged: Packet = {
      ...packet,
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9c2e", title: "Pick \x1b[30;40mblack on black", reason: "why \x1b[5m" }] },
      recent: { ...packet.recent, data: [{ at, kind: "commit", project: "acme\x1b[31m", text: "fix \x1b[8mhidden" }] },
    };
    const sourced = /\x1b\[(?:30;40|5|31|8)m/;
    expect(renderAgentPacket(forged)).not.toContain("\x1b");
    expect(renderOperator(forged, false)).not.toContain("\x1b");
    expect(renderOperator(forged, true)).not.toMatch(sourced);
    expect(renderOperator(forged, false)).toContain("fix \uFFFD[8mhidden");
    expect(renderOperator(forged, false)).toContain("Pick \uFFFD[30;40mblack on black — why \uFFFD[5m");
    expect(renderOperator(forged, true)).toContain("\x1b[90m");
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

  test("two refreshes that read the same packet before record a crew change once, not once each", async () => {
    // A crew starting work opens several agent sessions at once, and each session's hook runs `kinas context --agent`:
    // with the cached packet older than 30 s, each computes the packet from that same packet before, and each saw the
    // same change. An event is recorded once by its ref, so the ref names the change, not the moment it was counted.
    const w = await makeWorld();
    const cache = ContextCache.open(w.dataDir);
    try {
      const config = loadConfig(w.env);
      const began = Date.now() - 120_000;
      await computePacket(config, cache, { now: began });
      const file = join(w.fmHome, "snapshot.json");
      const snapshot = JSON.parse(readFileSync(file, "utf8"));
      snapshot.tasks.find((t: { id: string }) => t.id === "t-101").current_state.state = "review";
      writeFileSync(file, JSON.stringify(snapshot));
      await Promise.all([computePacket(config, cache, { now: began + 60_000 }), computePacket(config, cache, { now: began + 60_001 })]);
      const changes = cache.recent(currentOrg(config), 100).filter((r) => r.text === "Add login rate limiting: working → review");
      expect(changes.length).toBe(1);
    } finally {
      cache.close();
      await w.cleanup();
    }
  });

  test("a file written after the wall clock stepped back is still an event: an older mtime is a change too", () => {
    // The packet before was read just ahead of a two-hour step back, so its stamps and mtimes read two hours ahead of
    // the files written since: an edit then has an mtime below the one recorded, and a new file one below the reading.
    const now = Date.now();
    const ahead = now + 2 * 3_600_000;
    const row = (path: string, modified_at: number) => ({ project: "acme", path, title: null, modified_at });
    const prev = { ...packet, artifacts: { state: "ok", note: null, at: ahead, data: [row("docs/a-9c2e.md", ahead - 1_000)] } } as Packet;
    const artifacts = { state: "ok" as const, note: null, at: now, data: [row("docs/a-9c2e.md", now - 60_000), row("docs/b-9c2e.md", now - 30_000)] };
    const events = activityEvents(prev, { projects: [], commits: new Map(), artifacts, crew: prev.crew, sessions: { ...packet.sessions, data: null } }, now);
    expect(events.map((e) => [e.kind, e.text, e.at])).toEqual([
      ["file", "docs/a-9c2e.md changed", now - 60_000],
      ["file", "docs/b-9c2e.md changed", now - 30_000],
    ]);
    // Unchanged since the reading before, it is not an event, whatever the clock did.
    const same = { ...artifacts, data: [row("docs/a-9c2e.md", ahead - 1_000)] };
    expect(activityEvents(prev, { projects: [], commits: new Map(), artifacts: same, crew: prev.crew, sessions: packet.sessions }, now)).toEqual([]);
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

describe("quotas in the packet", () => {
  test("a reading that lands while the packet is being computed is fresh, not a stamp from before a clock step", async () => {
    // `now` is when the computation began; git across the projects can take seconds, and Codex and the app keep writing.
    // A reading stamped since then is newer than `now` without the clock having stepped back: it is judged when it is read.
    const w = await makeWorld();
    try {
      const began = Date.now() - 5_000;
      const landed = Date.now() - 1_000;
      const db = new Database(join(w.dataDir, "kinas.sqlite"));
      db.run("UPDATE quotas SET updated_at = ?", [landed]);
      db.close();
      const limits = { primary: { used_percent: 30, window_minutes: 300, resets_at: Math.floor((landed + 3_600_000) / 1000) } };
      write(
        join(w.codexHome, "sessions/2026/09/14/rollout-2026-09-14T20-00-00-abc.jsonl"),
        `${JSON.stringify({ timestamp: new Date(landed).toISOString(), type: "event_msg", payload: { type: "token_count", rate_limits: limits } })}\n`,
      );
      const p = await computePacket(loadConfig(w.env), null, { now: began, skipCrew: true });
      expect(p.quotas.data.map((q) => [q.provider, q.state])).toEqual([
        ["Claude", "fresh"],
        ["Codex", "fresh"],
        ["Ollama", "fresh"],
      ]);
    } finally {
      await w.cleanup();
    }
  });
});

describe("the crew in the packet", () => {
  test("a mirror the app writes while the packet is being computed stands for the fleet, not a stamp from before a clock step", async () => {
    // `now` is when the computation began; the projects' git is read first and can take seconds, while the app's
    // collector keeps writing. A mirror written since then is newer than `now` with no clock step behind it: it is
    // judged when it is read, so the launch screen does not read "pending" over a mirror written a second ago.
    const w = await makeWorld();
    try {
      const began = Date.now() - 5_000;
      const landed = Date.now() - 1_000;
      const db = new Database(join(w.dataDir, "kinas.sqlite"));
      db.run("INSERT INTO reader_status VALUES ('org-1', 'crew', 'ok', ?, ?, NULL, 180000, 43200000)", [landed, landed]);
      db.run(
        `INSERT INTO crew_tasks (org_id, id, title, kind, backlog_state, state, snapshot_generated, first_seen_at, last_seen_at)
         VALUES ('org-1', 'mirror-9c2e', 'Mirror task', 'ship', 'in_flight', 'working', '2026-09-25T09:00:00Z', ?, ?)`,
        [landed, landed],
      );
      db.close();
      const p = await computePacket(loadConfig(w.env), null, { now: began, skipCrew: true });
      expect(p.crew.state).toBe("ok");
      expect(p.crew.data?.in_flight.map((t) => t.id)).toEqual(["mirror-9c2e"]);
    } finally {
      await w.cleanup();
    }
  });
});
