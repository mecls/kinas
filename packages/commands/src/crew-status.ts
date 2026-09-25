// `kinas crew status` (build spec §4 The CLI, §6.13): the crew as the app last mirrored it, read from the store with the
// app open or closed. Counts, words, durations and PR numbers — never a task's id, title, repository, path, URL, key,
// summary or text. The JSON is built field by field, so a column added to the mirror can never leak into it.

import type { CrewStore } from "@kinas/store/types";
import { FIRSTMATE_PIN, TOOLS } from "./crew-tools.ts";
import { inFlight, wordOf, type CrewWord } from "./crew-words.ts";

export interface CrewStatus {
  installed: boolean;
  /** The pin, short. */
  pin: string;
  /** The commit the app last saw Firstmate's home at, short; null before it has looked. */
  at: string | null;
  tools: { name: string; version: string | null; ok: boolean }[];
  counts: { queued: number; in_flight: number; needs_decision: number; ci_red: number; ready: number; done_7d: number };
  waiting: number;
  tasks: { word: CrewWord; elapsed_s: number | null; pr: number | null }[];
}

interface StoredHealth {
  at?: unknown;
  tools?: unknown;
}

/** The reads `kinas crew status` makes — counts and words only, never a name (§6.13). */
export type CrewStatusStore = Pick<CrewStore, "schemaVersion" | "getCrewTasks" | "getCrewWaiting" | "getCrewHealth">;

export function crewStatusFromStore(store: CrewStatusStore, now: number, installed: boolean): CrewStatus {
  const rows = store.getCrewTasks(now);
  const words = rows.map((r) => ({ row: r, word: wordOf(r) }));
  const count = (w: CrewWord) => words.filter((x) => x.word === w).length;
  const health = (store.getCrewHealth() ?? {}) as StoredHealth;
  const stored = Array.isArray(health.tools) ? (health.tools as { name?: unknown; version?: unknown; ok?: unknown }[]) : [];
  return {
    installed,
    pin: FIRSTMATE_PIN.slice(0, 7),
    at: typeof health.at === "string" ? health.at.slice(0, 7) : null,
    tools: TOOLS.map((t) => {
      const seen = stored.find((s) => s.name === t.name);
      return { name: t.name, version: typeof seen?.version === "string" ? seen.version : null, ok: seen?.ok === true };
    }),
    counts: {
      queued: count("queued"),
      in_flight: words.filter((x) => inFlight(x.word)).length,
      needs_decision: count("needs decision"),
      ci_red: count("CI red"),
      ready: count("ready"),
      done_7d: count("done"),
    },
    waiting: store.getCrewWaiting(),
    tasks: words.map(({ row, word }) => ({
      word,
      elapsed_s: row.first_working_at === null ? null : Math.max(0, Math.round(((row.done_at ?? now) - row.first_working_at) / 1000)),
      pr: row.pr_number,
    })),
  };
}

/** Field by field (the `statusJson` model): nothing here can carry a task's name. */
export function crewStatusJson(s: CrewStatus): Record<string, unknown> {
  return {
    installed: s.installed,
    pin: s.pin,
    at: s.at,
    tools: s.tools.map((t) => ({ name: t.name, version: t.version, ok: t.ok })),
    counts: {
      queued: s.counts.queued,
      in_flight: s.counts.in_flight,
      needs_decision: s.counts.needs_decision,
      ci_red: s.counts.ci_red,
      ready: s.counts.ready,
      done_7d: s.counts.done_7d,
    },
    waiting: s.waiting,
    tasks: s.tasks.map((t) => ({ word: t.word, elapsed_s: t.elapsed_s, pr: t.pr })),
  };
}

export function crewStatusLines(s: CrewStatus): string[] {
  const missing = s.tools.filter((t) => !t.ok && TOOLS.find((x) => x.name === t.name)?.required);
  const pin = s.at === null ? `${s.pin} (pinned)` : s.at === s.pin ? `${s.at} (pinned)` : `${s.at} — moved from ${s.pin}`;
  const c = s.counts;
  return [
    `Firstmate   ${s.installed ? pin : "not installed — run kinas crew setup in the Work pane"}`,
    `Tools       ${missing.length === 0 ? `all ${s.tools.filter((t) => t.ok).length} installed` : `missing: ${missing.map((t) => t.name).join(", ")}`}`,
    `Crew        ${c.in_flight} in flight · ${c.queued} queued · ${c.needs_decision} needs decision · ${c.ci_red} CI red · ${c.ready} ready · ${c.done_7d} done this week`,
    `Waiting     ${s.waiting} on you`,
  ];
}
