// Features in progress (the first mate's build spec §4 The CLI, AC-19): each project's `tasks/<feature>/status.md` —
// AGENTS.md's resume file — read as text and reduced to one line: the first gate not yet approved, else the first
// slice not yet ticked, else nothing (the feature is done). `tasks/_templates/` is skipped; a file with no gate line
// reads `status unreadable`. Only the files are read; nothing is written, and nothing here is logged.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Feature {
  project: string;
  slug: string;
  /** "Gate 2 · Architecture in progress" | "slice 3 of 8 — <slice line>" | "status unreadable" */
  line: string;
}

export interface Status {
  gates: { n: number; name: string; state: string }[];
  slices: { done: boolean; text: string }[];
}

/** The largest status file read, in bytes; a bigger one reads as unreadable. */
const MAX_STATUS_BYTES = 262_144;

/** The gates at the top level (`- Gate N · Name: state`, never an indented sub-item) and the slices' checkboxes. */
export function parseStatus(text: string): Status | null {
  const gates: Status["gates"] = [];
  const slices: Status["slices"] = [];
  for (const line of text.split("\n")) {
    const gate = /^- Gate (\d+) · ([^:]+):\s*(.+)$/.exec(line);
    if (gate) {
      gates.push({ n: Number(gate[1]), name: gate[2]!.trim(), state: gate[3]!.trim() });
      continue;
    }
    const slice = /^- \[( |x|X)\] (Slice .+)$/.exec(line);
    if (slice) slices.push({ done: slice[1] !== " ", text: slice[2]!.trim() });
  }
  return gates.length === 0 ? null : { gates, slices };
}

/** Approved when its state begins with APPROVED (the template: `APPROVED <date>`). */
const approved = (state: string) => /^APPROVED\b/.test(state);

/** The state's first words, as the template writes them: `pending`, `in progress`. */
const stateWords = (state: string) => state.split(/[—(,;]/)[0]!.trim().toLowerCase();

/** One feature's line, or null when every gate is approved and every slice ticked. */
export function featureLine(status: Status | null): string | null {
  if (!status) return "status unreadable";
  const gate = status.gates.find((g) => !approved(g.state));
  if (gate) return `Gate ${gate.n} · ${gate.name} ${stateWords(gate.state)}`;
  const at = status.slices.findIndex((s) => !s.done);
  if (at < 0) return null;
  return `slice ${at + 1} of ${status.slices.length} — ${status.slices[at]!.text}`;
}

/** Every feature in progress across the projects, in the projects' order and each project's folders by name. */
export function featuresOf(projects: readonly { name: string; path: string }[]): Feature[] {
  const out: Feature[] = [];
  for (const p of projects) {
    const tasks = join(p.path, "tasks");
    let slugs: string[];
    try {
      slugs = readdirSync(tasks, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "_templates" && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const file = join(tasks, slug, "status.md");
      if (!existsSync(file)) continue;
      let status: Status | null = null;
      try {
        if (statSync(file).size <= MAX_STATUS_BYTES) status = parseStatus(readFileSync(file, "utf8"));
      } catch {
        status = null;
      }
      const line = featureLine(status);
      if (line) out.push({ project: p.name, slug, line });
    }
  }
  return out;
}
