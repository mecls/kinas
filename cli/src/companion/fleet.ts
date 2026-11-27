// Firstmate's fleet snapshot (`fm-fleet-snapshot.v1`), read as far as the cloud summary needs it: each task's title,
// project, kind, harness, state, PR and open decisions, merged from its backlog record and its `tasks[]` row as the Mac's
// `snapshot::parse_fleet` merges them. Only the schema is checked; unknown fields are ignored (build spec §6.5). Nothing
// here is a path or a branch name: the summary never carries them, so this module never returns them.

export interface FleetTask {
  id: string;
  title: string | null;
  /** The project's name in Firstmate: the clone's folder name, else the record's `repo:` text. */
  project: string | null;
  kind: string;
  harness: string | null;
  backlogState: string | null;
  state: string | null;
  stateSource: string | null;
  /** `current_state.observed_at`, as Firstmate wrote it. */
  observedAt: string | null;
  prUrl: string | null;
  pendingDecision: boolean;
  blockedEvent: boolean;
  captainActionable: boolean;
  holdReason: string | null;
  openDecisions: { key: string; verb: string; summary: string }[];
}

const at = (v: unknown, path: string[]): unknown => {
  let cur = v;
  for (const k of path) cur = cur && typeof cur === "object" && !Array.isArray(cur) ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
};
/** A non-empty string at `path`; Firstmate writes `""` for "none" as often as `null`. */
const text = (v: unknown, path: string[]): string | null => {
  const s = at(v, path);
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
};
const flag = (v: unknown, path: string[]): boolean => at(v, path) === true;
const array = (v: unknown, path: string[]): unknown[] => {
  const a = at(v, path);
  return Array.isArray(a) ? a : [];
};
const lastComponent = (p: string): string | null => p.replace(/\/+$/, "").split("/").pop() || null;

export function fleetOf(snapshot: string): FleetTask[] | null {
  let root: unknown;
  try {
    root = JSON.parse(snapshot);
  } catch {
    return null;
  }
  if (text(root, ["schema"]) !== "fm-fleet-snapshot.v1") return null;
  const tasks = new Map<string, FleetTask>();
  const blank = (id: string): FleetTask => ({ id, title: null, project: null, kind: "", harness: null, backlogState: null, state: null, stateSource: null, observedAt: null, prUrl: null, pendingDecision: false, blockedEvent: false, captainActionable: false, holdReason: null, openDecisions: [] });
  const record = (t: FleetTask, r: unknown) => {
    t.title = text(r, ["title"]);
    t.kind = text(r, ["kind"]) ?? "";
    t.backlogState = text(r, ["state"]);
    t.captainActionable = flag(r, ["captain_actionable"]);
    t.holdReason = text(r, ["hold_reason"]);
    t.prUrl = text(r, ["pr_url"]);
    t.project = text(r, ["repo"]);
  };
  for (const r of array(root, ["backlog", "records"])) {
    const id = text(r, ["id"]);
    if (!flag(r, ["structured"]) || id === null || tasks.has(id)) continue;
    const t = blank(id);
    record(t, r);
    tasks.set(id, t);
  }
  for (const row of array(root, ["tasks"])) {
    const id = text(row, ["id"]);
    if (id === null) continue;
    let t = tasks.get(id);
    if (!t) {
      t = blank(id);
      const backlog = at(row, ["backlog"]);
      if (backlog && typeof backlog === "object") record(t, backlog);
      tasks.set(id, t);
    }
    t.kind = text(row, ["kind"]) ?? t.kind;
    const projectPath = text(row, ["project"]);
    t.project = (projectPath ? lastComponent(projectPath) : null) ?? t.project;
    t.harness = text(row, ["harness"]);
    t.state = text(row, ["current_state", "state"]);
    t.stateSource = text(row, ["current_state", "source"]);
    t.observedAt = text(row, ["current_state", "observed_at"]);
    t.prUrl = text(row, ["pr", "url"]) ?? t.prUrl;
    t.pendingDecision = flag(row, ["hints", "pending_decision"]);
    t.blockedEvent = flag(row, ["hints", "blocked_event"]);
    t.openDecisions = array(row, ["hints", "open_decisions"]).flatMap((d) => {
      const key = text(d, ["key"]);
      const verb = text(d, ["verb"]);
      return key !== null && verb !== null ? [{ key, verb, summary: text(d, ["summary"]) ?? "" }] : [];
    });
  }
  for (const t of tasks.values()) if (t.kind === "") t.kind = "ship";
  return [...tasks.values()];
}
