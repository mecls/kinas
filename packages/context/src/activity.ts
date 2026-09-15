// Recent: notable events across projects, found by comparing what each refresh sees with the packet before it —
// commits, crew task state changes, briefs filed, and artifacts written (attributed to the agent working in that
// project when Herdr shows one). An event is recorded once, by its ref.

import type { ActivityEvent } from "./cache.ts";
import type { ArtifactRow, Crew, Packet, ProjectRow, Section, Sessions } from "./packet.ts";
import type { CommitRef } from "./sources/projects.ts";

export interface Observation {
  projects: ProjectRow[];
  commits: Map<string, CommitRef[]>;
  artifacts: Section<ArtifactRow[]>;
  crew: Section<Crew | null>;
  sessions: Section<Sessions | null>;
}

function commitEvents(next: Observation): ActivityEvent[] {
  return next.projects.flatMap((p) =>
    (next.commits.get(p.path) ?? []).map((c): ActivityEvent => ({ ref: `commit:${p.path}:${c.sha}`, at: c.at, kind: "commit", project: p.name, text: c.subject })),
  );
}

function crewEvents(prev: Crew, next: Crew, now: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const before = new Map(prev.in_flight.map((t) => [t.id, t]));
  const after = new Map(next.in_flight.map((t) => [t.id, t]));
  for (const t of next.in_flight) {
    const was = before.get(t.id);
    if (!was) events.push({ ref: `crew:${t.id}:in_flight:${now}`, at: now, kind: "crew", project: t.project, text: `${t.title} is in flight (${t.state})` });
    else if (was.state !== t.state) events.push({ ref: `crew:${t.id}:${t.state}:${now}`, at: now, kind: "crew", project: t.project, text: `${t.title}: ${was.state} → ${t.state}` });
  }
  for (const t of prev.in_flight) {
    if (!after.has(t.id)) events.push({ ref: `crew:${t.id}:left:${now}`, at: now, kind: "crew", project: t.project, text: `${t.title} left in flight` });
  }
  const heldBefore = new Set(prev.blocked.map((b) => b.id));
  for (const b of next.blocked) {
    if (!heldBefore.has(b.id)) events.push({ ref: `crew:${b.id}:held:${now}`, at: now, kind: "crew", project: null, text: `${b.title} is waiting on a decision` });
  }
  const filedBefore = new Set([...prev.intake.map((b) => b.id), ...prev.in_flight.map((t) => t.id)]);
  for (const b of next.intake) {
    if (!filedBefore.has(b.id)) events.push({ ref: `brief:${b.id}`, at: now, kind: "brief", project: b.repo, text: `brief filed: ${b.title}` });
  }
  return events;
}

function fileEvents(prev: Section<ArtifactRow[]>, next: Observation): ActivityEvent[] {
  const before = new Map(prev.data.map((a) => [`${a.project}\0${a.path}`, a.modified_at]));
  const sessions = next.sessions.state === "ok" ? (next.sessions.data?.rows ?? []) : [];
  return next.artifacts.data
    .filter((a) => {
      const was = before.get(`${a.project}\0${a.path}`);
      return was === undefined ? a.modified_at > prev.at : a.modified_at > was;
    })
    .map((a): ActivityEvent => {
      const writer = sessions.find((s) => s.status === "working" && s.project === a.project);
      return {
        ref: `file:${a.project}:${a.path}:${a.modified_at}`,
        at: a.modified_at,
        kind: "file",
        project: a.project,
        text: writer ? `${a.path} written by ${writer.agent ?? "an agent"}` : `${a.path} changed`,
      };
    });
}

export function activityEvents(prev: Packet | null, next: Observation, now: number): ActivityEvent[] {
  const events = commitEvents(next);
  if (prev?.crew.state === "ok" && prev.crew.data && next.crew.state === "ok" && next.crew.data && next.crew.at !== prev.crew.at) {
    events.push(...crewEvents(prev.crew.data, next.crew.data, now));
  }
  if (prev?.artifacts.state === "ok" && next.artifacts.state === "ok") events.push(...fileEvents(prev.artifacts, next));
  return events;
}
