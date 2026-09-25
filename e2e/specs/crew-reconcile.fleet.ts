import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The reconcile pair's fleets and the fake home's inventory, shared by crew-reconcile-a and -b (not a spec: no
// `.e2e.ts`).

export const BROKEN = "broken-9c2e";
export const HEALTHY = "healthy-9c2e";

/** Firstmate's snapshot with the broken task (endpoint dead, worktree gone) and the healthy one, or the healthy alone. */
export function fleet(home: string, withBroken: boolean): string {
  const task = (id: string, endpoint: { exists: boolean; status: string }, worktree: boolean) => ({
    record: { structured: true, id, title: `${id} title`, kind: "ship", state: "in_flight", repo: "shop-9c2e" },
    row: {
      id,
      kind: "ship",
      harness: "claude",
      project: `${home}/projects/shop-9c2e`,
      current_state: { state: "working", source: "status-log", detail: "9c2e", observed_at: new Date().toISOString() },
      endpoint: { target: `kinas-e2e-crew:w-${id}:p1`, ...endpoint },
      paths: { worktree: { path: `${home}/treehouse/${id}`, present: worktree } },
      hints: { pending_decision: false, blocked_event: false, open_decisions: [] },
    },
  });
  const tasks = [...(withBroken ? [task(BROKEN, { exists: true, status: "dead" }, false)] : []), task(HEALTHY, { exists: true, status: "unknown" }, true)];
  return JSON.stringify({
    schema: "fm-fleet-snapshot.v1",
    generated: new Date().toISOString(),
    backlog: { records: tasks.map((t) => t.record) },
    tasks: tasks.map((t) => t.row),
    main_inventory: { orphan_in_flight: [] },
  });
}

/** Every file under the fake home but the calls log and the spec's own snapshot, with its size and mtime. */
export function inventory(home: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const s = statSync(path);
      const rel = relative(home, path);
      if (s.isDirectory()) walk(path);
      else if (rel !== join("state", "calls.log") && !rel.startsWith("fixtures")) out.push(`${rel} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk(home);
  return out.sort();
}
