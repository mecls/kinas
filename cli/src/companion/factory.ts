// The factory's events on the companion (build spec §11.3 B, slice 11.2; PRD rules 18–21): after each reading the new events
// are derived (packages/factory), appended to `events.jsonl` in the state folder, and sent to the cloud store. The file only
// grows: a line is added once per task, event and time, and none is ever rewritten or removed. The cloud keeps each once too,
// so a restart can tell it the whole record again. A cloud that fails costs nothing: the events are in the file, and go next time.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eventsFrom, ledgerEventsOf, type AnswerEvent, type FactoryEvent, type View } from "@kinas/factory";
import { CloudError, type Cloud, type Summary } from "./cloud.ts";

export const EVENTS_FILE = "events.jsonl";
/** One call to the cloud carries at most this many (`cloud/convex/lib/factory.ts` MAX_EVENTS). */
const BATCH = 200;
const MAX_TASK = 128;
const MAX_PROJECT = 100;
const NAMES = new Set(["dispatched", "pr_ready", "merged", "cleaned_up", "held", "answered", "hold_closed", "red", "tokens"]);

export interface FactoryDeps {
  paths: { state: string };
  /** The cloud store, when this machine has one; without it the events are only kept. */
  cloud: Cloud | null;
  log: (line: string) => void;
  /** The fleet ledger from a cursor, or null when there is none (run.ts `ledgerSince`). */
  ledger: (cursor: { epoch: string; offset: number } | null) => { epoch: string; to: number; text: string } | null;
  /** The answers this companion delivered, as events (the new view names each task's project). */
  answers: (view: View) => AnswerEvent[];
}

export interface FactoryState {
  loaded: boolean;
  seen: Set<string>;
  unsent: FactoryEvent[];
  prev: View | null;
  cursor: { epoch: string; offset: number } | null;
}

export const freshFactory = (): FactoryState => ({ loaded: false, seen: new Set(), unsent: [], prev: null, cursor: null });

const idOf = (e: FactoryEvent): string => `${e.task}\u0000${e.event}\u0000${e.at}`;

/** The summary's board and waiting items: all the factory reads of a reading. */
export function viewOf(s: Pick<Summary, "asOf" | "board" | "waiting">): View {
  return {
    asOf: s.asOf,
    board: s.board.map((t) => ({ task: t.task, project: t.project, word: t.word })),
    waiting: s.waiting.map((w) => ({ key: w.key, task: w.task, project: w.project, since: w.since })),
  };
}

/** The events in the log; a line that is not one is skipped, and no file is no events. */
export function loadEvents(state: string): FactoryEvent[] {
  let text: string;
  try {
    text = readFileSync(join(state, EVENTS_FILE), "utf8");
  } catch {
    return [];
  }
  const out: FactoryEvent[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    try {
      const j = JSON.parse(line) as Record<string, unknown>;
      if (typeof j.task !== "string" || typeof j.project !== "string" || typeof j.event !== "string" || !NAMES.has(j.event) || !Number.isSafeInteger(j.at)) continue;
      out.push({ task: j.task, project: j.project, event: j.event as FactoryEvent["event"], at: j.at as number, ...(typeof j.value === "number" ? { value: j.value } : {}) });
    } catch {
      // not an event
    }
  }
  return out;
}

/** Add the events not yet in the log (by task, event and time), each as one whole line; returns the ones added. */
export function appendEvents(state: string, seen: Set<string>, events: FactoryEvent[]): FactoryEvent[] {
  const fresh: FactoryEvent[] = [];
  for (const e of events) {
    const id = idOf(e);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(e);
  }
  if (fresh.length > 0) {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    appendFileSync(join(state, EVENTS_FILE), fresh.map((e) => `${JSON.stringify(e)}\n`).join(""), { mode: 0o600 });
  }
  return fresh;
}

const clamp = (e: FactoryEvent): FactoryEvent => ({ ...e, task: e.task.slice(0, MAX_TASK), project: e.project.slice(0, MAX_PROJECT) });

/** After one reading: derive, keep, and send. Never throws: a cloud that fails is logged by its status alone. */
export async function tendFactory(deps: FactoryDeps, view: View, st: FactoryState): Promise<void> {
  if (!st.loaded) {
    for (const e of loadEvents(deps.paths.state)) {
      st.seen.add(idOf(e));
      if (deps.cloud) st.unsent.push(e);
    }
    st.loaded = true;
  }
  let chunk: ReturnType<FactoryDeps["ledger"]> = null;
  try {
    chunk = deps.ledger(st.cursor);
  } catch {
    chunk = null;
  }
  const derived = eventsFrom(st.prev, view, chunk ? ledgerEventsOf(chunk.text) : [], deps.answers(view)).map(clamp);
  st.prev = view;
  if (chunk) st.cursor = { epoch: chunk.epoch, offset: chunk.to };
  const fresh = appendEvents(deps.paths.state, st.seen, derived);
  if (fresh.length > 0) {
    deps.log(`companion: factory ${fresh.length} new events`);
    if (deps.cloud) st.unsent.push(...fresh);
  }
  if (!deps.cloud || st.unsent.length === 0) return;
  try {
    while (st.unsent.length > 0) {
      const batch = st.unsent.slice(0, BATCH);
      await deps.cloud.appendFactory(batch);
      st.unsent.splice(0, batch.length);
    }
  } catch (e) {
    deps.log(`companion: cloud failed (${e instanceof CloudError ? e.status : "error"})`);
  }
}
