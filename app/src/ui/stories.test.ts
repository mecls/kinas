import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as library from "./index.ts";
import { STORIES } from "./stories/catalogue.tsx";

// DESIGN.md §4 names the components; §9 says each exists once in app/src/ui/ with a story per state. This holds the
// three together: every component the law names has a file here, an export, and at least one story — or a reason,
// written below, why not yet.

const design = readFileSync(join(import.meta.dir, "../../../DESIGN.md"), "utf8");
const section4 = design.slice(design.indexOf("## 4. Components"), design.indexOf("## 5. The pages"));
const named = [...section4.matchAll(/^\*\*([A-Z][^.*]+?)(?: \(new[^)]*\))?\.\*\*/gm)].map((m) => m[1]!);

/** DESIGN.md's name → the library's, where the two differ. */
const FILE: Record<string, string> = {
  "Metric row": "MetricRow",
  "Section header": "SectionHeader",
  "Status badge": "StatusBadge",
  "Progress row": "ProgressRow",
  "Inbox item": "InboxItem",
  "Terminal chrome": "TerminalChrome",
  "Change mark": "ChangeMark",
  "Settings field": "Field",
  "Accent field": "AccentField",
  "Empty state": "Toast",
  Toast: "Toast",
  Lane: "Card",
  Switch: "Field",
  "Tab strip": "TabStrip",
};

/** Not in app/src/ui/ yet, each with its reason. */
const NOT_YET: Record<string, string> = {
  "Reader header": "the reader's own header (app/src/reader/Header.tsx), on the tokens since slice 6 — not a library piece",
  Palette: "the palette's own (app/src/palette/), on the tokens since slice 6 — not a library piece",
  "Tab bar": "the phone — not built in this pass (DESIGN.md §3.3)",
  "Launch form": "the phone and the palette's launch form — Build 3",
  Diff: "tree changes, slice 5 — written into DESIGN.md first (docs first); built with its stories then",
};

const stories = new Map(STORIES.map((s) => [s.component, s.states.map((st) => st.name)]));

describe("the law, the library and the stories agree (DESIGN.md §4, §9)", () => {
  test("DESIGN.md §4 names the components this test reads", () => {
    expect(named.length).toBeGreaterThanOrEqual(18);
    expect(named).toContain("Gauge");
    expect(named).toContain("Status badge");
  });

  for (const name of named) {
    test(`${name}`, () => {
      if (NOT_YET[name]) return;
      const file = FILE[name] ?? name;
      expect(existsSync(join(import.meta.dir, `${file}.tsx`)), `app/src/ui/${file}.tsx`).toBe(true);
      // A small component shares its file with the one it belongs beside (Lane with Card, Switch with Field, the
      // empty state with the toast); its export and story keep its own name.
      const exported = name === "Empty state" ? "EmptyState" : name === "Lane" || name === "Switch" ? name : (FILE[name] ?? name);
      expect(Object.keys(library), `${exported} exported from ui/index.ts`).toContain(exported);
      const storyName = name === "Empty state" ? "EmptyState" : name === "Settings field" || name === "Accent field" || name === "Switch" ? "Field" : name === "Lane" ? "Lane" : (FILE[name] ?? name);
      expect(stories.has(storyName), `a story for ${storyName}`).toBe(true);
      expect(stories.get(storyName)!.length).toBeGreaterThan(0);
    });
  }

  test("the badge stories are the ten states of DESIGN.md's table, plus the counted form", () => {
    expect(stories.get("StatusBadge")).toEqual(["queued", "working", "blocked", "red", "done", "stale", "dead", "decision", "pr", "ready", "counted"]);
    expect(stories.get("Gauge")).toEqual(["fine", "warn", "danger", "stale", "dead"]);
  });

  test("every story name is unique within its component", () => {
    for (const [component, names] of stories) expect(new Set(names).size, component).toBe(names.length);
  });
});

describe("DESIGN.md §4's catalogue is the stories as built", () => {
  test("every component and every state in the table, in order, and nothing else", () => {
    const table = section4.slice(section4.indexOf("**The catalogue"));
    const rows = [...table.matchAll(/^\| ([A-Za-z]+) \| ([a-z0-9, -]+) \|$/gm)].map((m) => `${m[1]}: ${m[2]}`);
    expect(rows).toEqual(STORIES.map((s) => `${s.component}: ${s.states.map((st) => st.name).join(", ")}`));
  });
});
