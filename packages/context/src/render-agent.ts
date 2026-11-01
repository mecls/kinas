// `kinas context --agent`: the packet as markdown for the start of an agent session. The headings are a contract —
// hooks and briefs look for them — and the order puts what rarely changes first (the instance, the artifact index,
// the conventions) and what changes by the minute last, so providers that cache prompt prefixes can reuse it.
//
//   # Kinas context · ## Projects · ## Features in progress · ## Artifacts · ## Conventions · ## Crew · ## Sessions ·
//   ## Decisions · ## Quotas · ## Recent
//
// Packet version 2 (2026-09-25, the first mate): Features in progress, after Projects.

import type { Packet, Section } from "./packet.ts";
import { ago, lisbonStamp } from "./time.ts";

export const AGENT_HEADINGS = ["# Kinas context", "## Projects", "## Features in progress", "## Artifacts", "## Conventions", "## Crew", "## Sessions", "## Decisions", "## Quotas", "## Recent"] as const;

/**
 * One line of the packet, whatever a source put in it: a newline inside a title, a hold reason, an event text or a
 * source's own error message would start a new line of markdown — one that could read as `## Crew`, a heading hooks
 * look for — so it becomes a space. A lone carriage return is a line ending to CommonMark too, so it goes the same way.
 * The operator's view and the launch screen fold their rows with it as well: one row per thing, whatever it says.
 * Nor is any other control character obeyed: an escape, a bell, a backspace or a C1 control (a commit subject keeps
 * whatever its author typed, `ESC ] 52` included, which sets a terminal's clipboard) becomes U+FFFD, shown as text. The
 * one escape kept is a colour (`ESC [ … m`), which the CLI paints its own rows with — a source's own colours are gone
 * by then (`shown`).
 */
export const flat = (line: string): string =>
  line.replace(/\s*(?:\r\n?|\n)\s*/g, " ").replace(/\x1b\[[0-9;]*m|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, (c) => (c.length > 1 ? c : "�"));

/**
 * A packet (or any reading) as the CLI shows it: every string a source put in it with its control characters as U+FFFD
 * — an escape, a colour (`ESC [ … m`) included, a bell, a backspace, a NUL, a C1 control — and its tabs and line breaks
 * kept, for `flat` to fold and `nestHeadings` to split. Each renderer takes its packet through this first and paints
 * afterwards, so the one escape `flat` keeps is the CLI's own: no commit subject, title or convention can set a
 * terminal's clipboard, or hide and recolour the rows after it.
 */
export function shown<T>(value: T): T {
  if (typeof value === "string") return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "�") as T;
  if (Array.isArray(value)) return value.map(shown) as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shown(v)])) as T;
  return value;
}

const cell = (v: string | number | null | undefined): string => (v === null || v === undefined || v === "" ? "—" : flat(String(v).replace(/\|/g, "\\|")));

function table(head: string[], rows: (string | number | null)[][]): string {
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

/** The one line a section shows when its source could not be read. */
function missing(section: Section<unknown>): string | null {
  if (section.state === "unavailable") return flat(`_Unavailable: ${section.note ?? "could not be read"}._`);
  if (section.state === "pending") return "_Not read yet._";
  return null;
}

function asOf(section: Section<unknown>, now: number): string {
  const stale = section.note ? ` · ${section.note}` : "";
  return flat(`_As of ${lisbonStamp(section.at)} (${ago(section.at, now)})${stale}._`);
}

export function renderHeader(p: Packet): string {
  const i = p.instance;
  return [
    "# Kinas context",
    "",
    `- Instance: ${i.org} · ${i.instance}, on ${i.machine}`,
    `- Generated: ${lisbonStamp(p.generated_at)} Europe/Lisbon (${new Date(p.generated_at).toISOString()})`,
    `- Packet version: ${p.version}`,
    `- Kinas ${i.version} · projects root ${i.root}`,
    flat(`- Interactive sessions: ${i.harness ?? "harness not detected"} · ${i.model ?? "model not set"}`),
    "",
    "Sections: Projects, Features in progress, Artifacts, Conventions, Crew, Sessions, Decisions, Quotas, Recent. A section whose source could not be read says so in one line. Times are Europe/Lisbon.",
  ].join("\n");
}

export function renderProjects(p: Packet): string {
  const s = p.projects;
  const body =
    missing(s) ??
    [
      asOf(s, p.generated_at),
      "",
      table(
        ["Name", "Path", "Branch", "Dirty", "Ahead/behind", "Last commit", "Artifacts"],
        s.data.map((r) =>
          r.error
            ? [r.name, r.path, `unreadable: ${r.error}`, null, null, null, null]
            : [
                r.name,
                r.path,
                r.branch ?? (r.head ? `detached at ${r.head}` : "no commits yet"),
                r.dirty,
                r.upstream ? `+${r.ahead ?? "?"} / -${r.behind ?? "?"} vs ${r.upstream}` : "no upstream",
                r.last_commit_at ? `${lisbonStamp(r.last_commit_at)} — ${r.last_commit_subject ?? ""}` : null,
                r.artifacts === 0 ? "none" : `${r.artifacts} (see Artifacts)`,
              ],
        ),
      ),
    ].join("\n");
  return `## Projects\n\n${body}`;
}

export function renderArtifacts(p: Packet): string {
  const s = p.artifacts;
  const lines = ["## Artifacts", ""];
  const gone = missing(s);
  if (gone) return [...lines, gone].join("\n");
  lines.push("Found by convention: AGENTS.md, README.md, docs/, plans/, specs/, and con-*, spec-*, plan-*, epic-* files. Paths are relative to the project; load what you need.");
  for (const project of p.projects.data.filter((r) => !r.error)) {
    const rows = s.data.filter((a) => a.project === project.name);
    lines.push("", flat(`### ${project.name} — ${project.path}`), "");
    lines.push(rows.length === 0 ? "No artifacts found by convention." : table(["Path", "Title", "Modified"], rows.map((a) => [a.path, a.title, lisbonStamp(a.modified_at)])));
  }
  if (s.note) lines.push("", flat(`_${s.note}._`));
  return lines.join("\n");
}

/**
 * A convention's own headings, pushed below its `### path` heading (`#` becomes `####`, capped at `######`), so no line
 * of a convention can read as one of the packet's `#`/`##` headings. Lines inside code fences are left alone. A line
 * ends where CommonMark ends one — LF, CRLF or a lone CR — and comes out ending in LF; a heading may be indented by up
 * to three spaces, as CommonMark reads one.
 */
export function nestHeadings(body: string, by = 3): string {
  let fence: string | null = null;
  return body
    .replace(/(?:\r\n?|\n)+$/, "")
    .split(/\r\n?|\n/)
    .map((line) => {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        if (fence === null) fence = open[1]!;
        else if (open[1]!.startsWith(fence)) fence = null;
        return line;
      }
      if (fence !== null) return line;
      const heading = /^( {0,3})(#{1,6})([ \t].*)?$/.exec(line);
      return heading ? `${heading[1]}${"#".repeat(Math.min(6, heading[2]!.length + by))}${heading[3] ?? ""}` : line;
    })
    .join("\n");
}

export function renderConventions(p: Packet): string {
  const s = p.conventions;
  const lines = ["## Conventions", ""];
  const gone = missing(s);
  if (gone) return [...lines, gone].join("\n");
  lines.push("The org-level rules every agent follows, in full. Their headings are nested one level below each file's.");
  for (const doc of s.data) {
    lines.push("", flat(`### ${doc.path}`), "", nestHeadings(doc.body));
    if (doc.truncated) lines.push("", "_Cut at 64 KB; open the file for the rest._");
  }
  return lines.join("\n");
}

export function renderCrew(p: Packet): string {
  const s = p.crew;
  const gone = missing(s);
  if (gone || !s.data) return `## Crew\n\n${gone ?? "_Not read yet._"}`;
  const c = s.data;
  const list = <T>(items: T[], line: (item: T) => string) => (items.length === 0 ? ["- none"] : items.map((item) => flat(line(item))));
  return [
    "## Crew",
    "",
    flat(`${asOf(s, p.generated_at)} Firstmate home ${c.home} · contract ${c.schema}.`),
    "",
    `**In flight** (${c.in_flight.length})`,
    ...list(c.in_flight, (t) => `- \`${t.id}\` ${t.title} — ${[t.project, t.kind, t.state].filter(Boolean).join(" · ")}${t.worktree ? ` · worktree ${t.worktree}` : ""}`),
    "",
    `**Intake: open briefs** (${c.intake.length})`,
    ...list(c.intake, (b) => `- \`${b.id}\` ${b.title}${b.repo ? ` — ${b.repo}` : ""}${b.filed ? ` · filed ${b.filed}` : ""}`),
    "",
    `**Blocked on a decision** (${c.blocked.length})`,
    ...list(c.blocked, (b) => `- \`${b.id}\` ${b.title}${b.reason ? ` — ${b.reason}` : ""}`),
    "",
    "**Last task reports**",
    ...list(c.reports, (r) => `- ${r.path} — ${r.first_line ?? "(empty)"}`),
  ].join("\n");
}

export function renderSessions(p: Packet): string {
  const s = p.sessions;
  const gone = missing(s);
  if (gone || !s.data) return `## Sessions\n\n${gone ?? "_Not read yet._"}`;
  const head = flat(`${asOf(s, p.generated_at)} Herdr${s.data.server ? ` v${s.data.server}` : ""}.`);
  if (s.data.rows.length === 0) return `## Sessions\n\n${head}\n\nNo agent sessions.`;
  return `## Sessions\n\n${head}\n\n${table(
    ["Status", "Agent", "Workspace", "Project", "Title"],
    s.data.rows.map((r) => [r.status, r.agent, r.workspace, r.project ?? r.cwd, r.title]),
  )}`;
}

export function renderDecisions(p: Packet): string {
  const rows = p.decisions.data;
  if (rows.length === 0) return "## Decisions\n\nNothing is waiting on the human.";
  return `## Decisions\n\n${rows.map((d) => flat(`- ${d.source === "crew" ? `Crew task \`${d.id}\`` : `Session ${d.id}`}: ${d.title}${d.reason ? ` — ${d.reason}` : ""}`)).join("\n")}`;
}

/** "not connected: no Codex folder", without repeating the state when the note already starts with it. */
export function stateCell(state: string, note: string | null): string {
  if (!note) return state;
  return note.toLowerCase().startsWith(state) ? note : `${state}: ${note}`;
}

export function renderQuotas(p: Packet): string {
  const now = p.generated_at;
  return `## Quotas\n\nA reading older than 15 minutes is stale.\n\n${table(
    ["Plan", "Window", "Left", "Resets", "As of", "State"],
    p.quotas.data.map((q) => [
      q.provider,
      q.window,
      q.left_pct === null ? null : `${q.left_pct}%`,
      q.resets_at === null ? null : lisbonStamp(q.resets_at),
      q.updated_at === null ? null : `${lisbonStamp(q.updated_at)} (${ago(q.updated_at, now)})`,
      stateCell(q.state.replace("_", " "), q.note),
    ]),
  )}`;
}

export function renderRecent(p: Packet): string {
  const rows = p.recent.data;
  if (rows.length === 0) return "## Recent\n\nNothing recorded yet.";
  return `## Recent\n\n${rows.map((r) => flat(`- ${lisbonStamp(r.at)} (${ago(r.at, p.generated_at)}) · ${r.project ?? "—"} · ${r.kind} · ${r.text}`)).join("\n")}`;
}

/** Each project's features in progress, one line each, from `tasks/<feature>/status.md`. */
export function renderFeatures(p: Packet): string {
  const rows = p.features.data;
  if (rows.length === 0) return "## Features in progress\n\nNone.";
  return `## Features in progress\n\n${rows.map((f) => flat(`- ${f.project} · ${f.slug}: ${f.line}`)).join("\n")}`;
}

export function renderAgentPacket(packet: Packet): string {
  const p = shown(packet);
  return `${[renderHeader(p), renderProjects(p), renderFeatures(p), renderArtifacts(p), renderConventions(p), renderCrew(p), renderSessions(p), renderDecisions(p), renderQuotas(p), renderRecent(p)].join("\n\n")}\n`;
}
