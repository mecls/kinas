// Sessions: live Herdr agents from the Herdr socket (`session.snapshot`, newline-delimited JSON), best-effort.
// Read-only: one request, one answer, close.

import { connect } from "node:net";
import type { SessionRow, Sessions, SessionStatus } from "../packet.ts";
import { SourceError } from "../source.ts";

const STATUSES = new Set<SessionStatus>(["working", "blocked", "idle", "done", "unknown"]);
const ORDER: Record<SessionStatus, number> = { blocked: 0, working: 1, idle: 2, done: 3, unknown: 4 };
export const HERDR_TIMEOUT_MS = 1_000;

export function herdrSnapshot(socketPath: string, timeoutMs = HERDR_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new SourceError("herdr: not answering"))), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: "kinas:context", method: "session.snapshot", params: {} })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      finish(() => {
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new SourceError("herdr: unreadable answer from the socket"));
        }
      });
    });
    socket.on("error", (e: NodeJS.ErrnoException) =>
      finish(() => reject(new SourceError(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? "herdr: not running" : `herdr: ${e.message}`))),
    );
    socket.on("close", () => finish(() => reject(new SourceError("herdr: not running"))));
  });
}

/** The project whose folder holds `cwd` (the deepest match). */
export function projectFor(cwd: string | null, projects: { name: string; path: string }[]): string | null {
  if (!cwd) return null;
  let best: { name: string; path: string } | null = null;
  for (const p of projects) {
    if ((cwd === p.path || cwd.startsWith(`${p.path}/`)) && (!best || p.path.length > best.path.length)) best = p;
  }
  return best?.name ?? null;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function sessionsFromSnapshot(answer: unknown, projects: { name: string; path: string }[]): Sessions {
  const res = (answer ?? {}) as Json;
  if (res.error) {
    const message = str((res.error as Json).message) ?? "error";
    throw new SourceError(`herdr: ${message}`);
  }
  const snapshot = ((res.result as Json | undefined)?.snapshot ?? null) as Json | null;
  if (!snapshot || !Array.isArray(snapshot.agents)) throw new SourceError("herdr: unexpected snapshot shape");

  const workspaces = Array.isArray(snapshot.workspaces) ? (snapshot.workspaces as Json[]) : [];
  const labels = new Map(workspaces.map((w) => [str(w.workspace_id), str(w.label)]));
  const rows: SessionRow[] = (snapshot.agents as Json[]).map((a) => {
    const status = str(a.agent_status) as SessionStatus | null;
    const cwd = str(a.foreground_cwd) ?? str(a.cwd);
    return {
      agent: str(a.display_agent) ?? str(a.agent),
      status: status && STATUSES.has(status) ? status : "unknown",
      workspace: labels.get(str(a.workspace_id)) ?? null,
      title: str(a.terminal_title_stripped) ?? str(a.name),
      cwd,
      project: projectFor(cwd, projects),
      pane: str(a.pane_id) ?? "",
    };
  });
  rows.sort((x, y) => ORDER[x.status] - ORDER[y.status] || (x.workspace ?? "").localeCompare(y.workspace ?? ""));
  return { server: str(snapshot.version), rows };
}

export async function readSessions(socketPath: string, projects: { name: string; path: string }[]): Promise<Sessions> {
  return sessionsFromSnapshot(await herdrSnapshot(socketPath), projects);
}
