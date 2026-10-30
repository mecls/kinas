import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ContextCache } from "./cache.ts";
import { loadConfig } from "./config.ts";
import type { Packet } from "./packet.ts";
import { computePacket } from "./refresh.ts";
import { renderOperator } from "./render-operator.ts";
import { makeWorld, type World } from "./testing/world.ts";

let world: World;
let packet: Packet;

beforeAll(async () => {
  world = await makeWorld();
  const cache = ContextCache.open(world.dataDir);
  packet = await computePacket(loadConfig(world.env), cache);
  cache.close();
});
afterAll(() => world.cleanup());

describe("kinas context, the operator's view", () => {
  test("free text from a source stays on its indented line: a newline in a title, a reason or an event text does not start a stray line", () => {
    // What an agent or Firstmate wrote reaches the screen as one row each (render-agent.ts folds the same way).
    const forged: Packet = {
      ...packet,
      features: { ...packet.features, data: [{ project: "acme", slug: "pay-9c2e", line: "Gate 1 · Product\nin progress" }] },
      decisions: { ...packet.decisions, data: [{ source: "crew", id: "t-9", title: "Pick a key\nnow", reason: "needs the captain\r\nsee the notes" }] },
      recent: { ...packet.recent, data: [{ at: packet.generated_at, kind: "crew", project: "acme", text: "held\nfor a key" }] },
    };
    const lines = renderOperator(forged, false).split("\n");
    expect(lines).toContain("  acme · pay-9c2e: Gate 1 · Product in progress");
    expect(lines).toContain("  ▲ Pick a key now — needs the captain see the notes");
    expect(lines.some((l) => l.endsWith("  acme  held for a key"))).toBe(true);
    // Nothing of theirs on a line of its own.
    for (const stray of ["in progress", "now", "see the notes", "for a key"]) expect(lines).not.toContain(stray);
  });
});
