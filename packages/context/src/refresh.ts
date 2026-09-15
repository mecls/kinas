// Computes the packet: every source read at once, each with its own deadline, each stamped. Nothing here blocks on
// the network — every source is a local file, a local socket, or local git.

import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { DB_FILE } from "@kinas/store/sqlite-readonly";
import { activityEvents } from "./activity.ts";
import { CACHE_FILE, type ContextCache } from "./cache.ts";
import type { KinasConfig } from "./config.ts";
import { PACKET_VERSION, type Crew, type DecisionRow, type Instance, type Packet, type QuotaLine, type Section, type Sessions } from "./packet.ts";
import { pending, settle, withTimeout } from "./source.ts";
import { readAllArtifacts } from "./sources/artifacts.ts";
import { readConventions } from "./sources/conventions.ts";
import { readCrew } from "./sources/firstmate.ts";
import { readSessions } from "./sources/herdr.ts";
import { readProjects, type CommitRef } from "./sources/projects.ts";
import { codexQuotas, openStore, storeQuotas } from "./sources/quotas.ts";
import { KINAS_VERSION } from "./version.ts";

/** The org id when the app's store has none to give (it has not run yet). */
export const LOCAL_ORG = "local";
export const RECENT_IN_PACKET = 20;

const PROVIDER_ORDER = { Claude: 0, Codex: 1, Ollama: 2 } as const;

export function decisionsFrom(crew: Section<Crew | null>, sessions: Section<Sessions | null>): DecisionRow[] {
  const rows: DecisionRow[] = [];
  if (crew.state === "ok" && crew.data) {
    for (const b of crew.data.blocked) rows.push({ source: "crew", id: b.id, title: b.title, reason: b.reason });
  }
  if (sessions.state === "ok" && sessions.data) {
    for (const s of sessions.data.rows.filter((r) => r.status === "blocked")) {
      const where = s.project ?? s.workspace ?? s.cwd ?? "a pane";
      rows.push({ source: "session", id: s.pane, title: `${s.agent ?? "An agent"} in ${where} is blocked`, reason: s.title });
    }
  }
  return rows;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Configured, else the agent most live sessions run, else what the last packet detected (so Herdr going away changes
 * the Sessions section and nothing else), else Pi's defaults when Pi is set up.
 */
export function harnessAndModel(config: KinasConfig, sessions: Section<Sessions | null>, previous: string | null = null): { harness: string | null; model: string | null } {
  let harness = config.harness;
  if (!harness && sessions.state === "ok" && sessions.data) {
    const counts = new Map<string, number>();
    for (const s of sessions.data.rows) if (s.agent) counts.set(s.agent, (counts.get(s.agent) ?? 0) + 1);
    harness = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  if (!harness && sessions.state !== "ok") harness = previous;
  const pi = readJson(join(config.piAgentDir, "settings.json"));
  if (!harness && pi) harness = "pi";
  let model = config.model;
  if (!model && harness === "pi" && pi) {
    const provider = typeof pi.defaultProvider === "string" ? pi.defaultProvider : null;
    const id = typeof pi.defaultModel === "string" ? pi.defaultModel : null;
    model = id ? (provider ? `${provider}/${id}` : id) : null;
  }
  if (!model && harness === "claude") {
    const claude = readJson(join(config.claudeDir, "settings.json"));
    model = typeof claude?.model === "string" ? claude.model : null;
  }
  return { harness, model };
}

export interface ComputeOptions {
  now?: number;
  /** Leave the crew as it was (or pending): Firstmate's snapshot takes seconds, and a first launch must not wait. */
  skipCrew?: boolean;
}

export async function computePacket(config: KinasConfig, cache: ContextCache | null, opts: ComputeOptions = {}): Promise<Packet> {
  const now = opts.now ?? Date.now();
  const store = openStore(config.dataDir);
  try {
    const org = store.ok ? store.store.orgId() : LOCAL_ORG;
    const prev = cache?.readPacket(org)?.packet ?? null;

    let commits = new Map<string, CommitRef[]>();
    const projects = await settle(
      async () => {
        const reading = await withTimeout(readProjects(config.root), 10_000, "projects");
        commits = reading.commits;
        if (reading.rows.length === 0) throw new Error(`no git projects under ${config.root}`);
        return reading.rows;
      },
      [],
      now,
      prev?.projects,
    );

    let omitted = new Map<string, number>();
    const [artifacts, conventions, sessions, crew, codex] = await Promise.all([
      settle(
        async () => {
          const reading = await withTimeout(readAllArtifacts(projects.data), 10_000, "artifacts");
          omitted = reading.omitted;
          return reading.rows;
        },
        [],
        now,
        prev?.artifacts,
      ),
      settle(() => withTimeout(readConventions(config.hub), 5_000, "conventions"), [], now, prev?.conventions),
      settle(() => readSessions(config.herdrSocket, projects.data), null, now, prev?.sessions),
      opts.skipCrew ? Promise.resolve(prev?.crew ?? pending<Crew | null>(null, now)) : settle(() => readCrew(config.firstmateHome, now), null, now, prev?.crew),
      codexQuotas(config.codexHome, now).catch(
        (e): QuotaLine[] => [{ provider: "Codex", window: null, left_pct: null, resets_at: null, updated_at: null, state: "dead", note: `Codex logs could not be read (${(e as Error).message})` }],
      ),
    ]);

    if (omitted.size > 0) {
      artifacts.note = [...omitted].map(([name, n]) => `${n} older in ${name} not listed`).join("; ");
    }
    projects.data = projects.data.map((p) => ({ ...p, artifacts: artifacts.data.filter((a) => a.project === p.name).length }));

    const quotaLines = [...storeQuotas(store, now), ...codex].sort((a, b) => PROVIDER_ORDER[a.provider] - PROVIDER_ORDER[b.provider]);
    const events = activityEvents(prev, { projects: projects.data, commits, artifacts, crew, sessions }, now);
    cache?.record(org, events, now);
    const recent = cache ? cache.recent(org, RECENT_IN_PACKET) : events.sort((a, b) => b.at - a.at).slice(0, RECENT_IN_PACKET).map(({ ref: _ref, ...row }) => row);

    const { harness, model } = harnessAndModel(config, sessions, prev?.instance.harness ?? null);
    const instance: Instance = {
      org: config.org,
      instance: config.instance,
      machine: hostname().replace(/\.local$/, ""),
      version: KINAS_VERSION,
      store: join(config.dataDir, DB_FILE),
      cache: join(config.dataDir, CACHE_FILE),
      root: config.root,
      harness,
      model,
      herdr: sessions.state === "ok" ? `running${sessions.data?.server ? ` (v${sessions.data.server})` : ""}` : (sessions.note ?? "not read yet"),
    };

    const packet: Packet = {
      version: PACKET_VERSION,
      generated_at: now,
      instance,
      projects,
      artifacts,
      conventions,
      crew,
      sessions,
      decisions: { state: "ok", note: null, at: now, data: decisionsFrom(crew, sessions) },
      quotas: { state: "ok", note: null, at: now, data: quotaLines },
      recent: { state: "ok", note: null, at: now, data: recent },
    };
    cache?.writePacket(org, packet);
    return packet;
  } finally {
    if (store.ok) store.store.close();
  }
}

/** The org the cache rows belong to: the app's single org, or LOCAL_ORG before the app has run. */
export function currentOrg(config: KinasConfig): string {
  const store = openStore(config.dataDir);
  if (!store.ok) return LOCAL_ORG;
  try {
    return store.store.orgId();
  } finally {
    store.store.close();
  }
}
