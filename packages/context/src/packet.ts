// The context packet (CLI v0 brief): where the operation is right now, computed once, cached with timestamps, and
// rendered three ways — the launch screen, `kinas context`, and `kinas context --agent`. Every section is stamped
// with when its source was read, and a source that could not be read carries one honest line instead of data.

/** Bump when a field changes meaning or disappears; hooks and briefs key off it. */
export const PACKET_VERSION = 1;

export type SectionState = "ok" | "unavailable" | "pending";

export interface Section<T> {
  /** ok: `data` is a real reading. unavailable: `note` says why in one line. pending: not read yet. */
  state: SectionState;
  note: string | null;
  /** When the source was read (ms since the epoch). */
  at: number;
  data: T;
}

export interface Instance {
  org: string;
  instance: string;
  machine: string;
  version: string;
  /** The app's store, read-only. */
  store: string;
  /** The CLI's own cache file. */
  cache: string;
  root: string;
  harness: string | null;
  model: string | null;
  herdr: string;
}

export interface ProjectRow {
  name: string;
  path: string;
  /** null when HEAD is detached. */
  branch: string | null;
  /** Short commit id; null before the first commit. */
  head: string | null;
  dirty: number;
  upstream: string | null;
  /** null without an upstream. */
  ahead: number | null;
  behind: number | null;
  last_commit_at: number | null;
  last_commit_subject: string | null;
  artifacts: number;
  /** Set when git could not read this project; the other fields are then empty. */
  error: string | null;
}

export interface ArtifactRow {
  project: string;
  /** Relative to the project. */
  path: string;
  /** The first heading; null when there is none. */
  title: string | null;
  modified_at: number;
}

export interface ConventionDoc {
  /** Relative to the hub. */
  path: string;
  title: string | null;
  body: string;
  truncated: boolean;
}

export interface CrewTask {
  id: string;
  title: string;
  project: string | null;
  kind: string | null;
  state: string;
  worktree: string | null;
}

export interface CrewBrief {
  id: string;
  title: string;
  repo: string | null;
  filed: string | null;
}

export interface CrewHold {
  id: string;
  title: string;
  reason: string | null;
}

export interface CrewReport {
  id: string;
  path: string;
  first_line: string | null;
  modified_at: number;
}

export interface Crew {
  home: string;
  schema: string;
  generated: string;
  in_flight: CrewTask[];
  intake: CrewBrief[];
  blocked: CrewHold[];
  reports: CrewReport[];
}

export type SessionStatus = "working" | "blocked" | "idle" | "done" | "unknown";

export interface SessionRow {
  agent: string | null;
  status: SessionStatus;
  workspace: string | null;
  title: string | null;
  cwd: string | null;
  project: string | null;
  pane: string;
}

export interface Sessions {
  server: string | null;
  rows: SessionRow[];
}

export interface DecisionRow {
  source: "crew" | "session";
  id: string;
  title: string;
  reason: string | null;
}

export type QuotaState = "fresh" | "stale" | "reset" | "dead" | "not_connected";

export interface QuotaLine {
  provider: "Claude" | "Codex" | "Ollama";
  /** null for a provider with no readings at all. */
  window: string | null;
  left_pct: number | null;
  resets_at: number | null;
  updated_at: number | null;
  state: QuotaState;
  note: string | null;
}

export type ActivityKind = "commit" | "crew" | "brief" | "file";

export interface ActivityRow {
  at: number;
  kind: ActivityKind;
  project: string | null;
  text: string;
}

export interface Packet {
  version: number;
  generated_at: number;
  instance: Instance;
  projects: Section<ProjectRow[]>;
  artifacts: Section<ArtifactRow[]>;
  conventions: Section<ConventionDoc[]>;
  crew: Section<Crew | null>;
  sessions: Section<Sessions | null>;
  decisions: Section<DecisionRow[]>;
  quotas: Section<QuotaLine[]>;
  recent: Section<ActivityRow[]>;
}
