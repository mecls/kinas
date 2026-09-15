// `kinas` with no arguments: the launch screen. A static Ink render — drawn once, then the shell prompt returns. It
// reads no keys at all, so it never captures Tab and nothing can hold the terminal; there is nothing to quit.

import { accentLine, bannerLines, BANNER_WIDTH, glyph, LOGO_WIDTH, logoLines, paint, type Tone } from "@kinas/commands/theme";
import { age, ago, packetCounts, plural, until, type Packet, type QuotaLine, type Section } from "@kinas/context";
import { Box, renderToString, Text } from "ink";
import { homedir } from "node:os";

/** The screen is designed for 100 columns and never wider; below this the panels stack. */
export const MAX_COLUMNS = 100;
const SIDE_BY_SIDE_MIN = 88;
/** Below this the logo is left out and the banner stands alone. */
export const WITH_LOGO_MIN = 2 + LOGO_WIDTH + 3 + BANNER_WIDTH;
const LEFT_WIDTH = 34;
const ROWS = { projects: 8, crew: 3, sessions: 4, decisions: 3, recent: 5 } as const;

export interface LaunchOptions {
  columns: number;
  color: boolean;
  now: number;
}

const tilde = (p: string) => (p.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p);

function Line({ children }: { children: string }) {
  return <Text wrap="truncate-end">{children}</Text>;
}

function Heading({ title, section, o }: { title: string; section?: Section<unknown>; o: LaunchOptions }) {
  const stamp = section && o.now - section.at >= 60_000 ? paint("muted", `  ${age(section.at, o.now)} ago`, o.color) : "";
  return <Line>{`${paint("blue", title, o.color, true)}${stamp}`}</Line>;
}

/** The screen's version of a note: the reason without its parenthetical detail, which the agent packet keeps. */
export function shortNote(note: string): string {
  return note.replace(/\s*\([^)]*\)\s*$/, "");
}

/** The one line a section shows when its source could not be read. */
function unavailable(section: Section<unknown>, o: LaunchOptions): string | null {
  if (section.state === "pending") return paint("muted", "  reading…", o.color);
  if (section.state === "unavailable") return paint("muted", `  ${shortNote(section.note ?? "could not be read")}`, o.color);
  return null;
}

function more(total: number, shown: number, o: LaunchOptions): string[] {
  return total > shown ? [paint("muted", `  +${total - shown} more`, o.color)] : [];
}

function projectLines(p: Packet, o: LaunchOptions): string[] {
  const gone = unavailable(p.projects, o);
  if (gone) return [gone];
  const rows = p.projects.data.slice(0, ROWS.projects);
  const nameWidth = Math.min(16, Math.max(...rows.map((r) => r.name.length)));
  return [
    ...rows.map((r) => {
      const name = paint("white", r.name.padEnd(nameWidth), o.color);
      if (r.error) return `  ${name}  ${paint("crimson", `${glyph.failing} unreadable`, o.color)}`;
      const branch = r.branch ?? (r.head ? `@${r.head}` : "no commits");
      const dirty = r.dirty === 0 ? paint("muted", "clean", o.color) : paint("white", `${r.dirty} dirty`, o.color);
      const sync = r.upstream ? `${glyph.ahead}${r.ahead ?? "?"}${glyph.behind}${r.behind ?? "?"}` : "local";
      const last = r.last_commit_at ? age(r.last_commit_at, o.now) : "—";
      return `  ${name}  ${paint("muted", branch, o.color)} ${glyph.sep} ${dirty} ${paint("muted", `${glyph.sep} ${sync} ${glyph.sep} ${last}`, o.color)}`;
    }),
    ...more(p.projects.data.length, rows.length, o),
  ];
}

function crewLines(p: Packet, o: LaunchOptions): string[] {
  const gone = unavailable(p.crew, o);
  if (gone || !p.crew.data) return [gone ?? paint("muted", "  reading…", o.color)];
  const c = p.crew.data;
  const lines = [paint("gold", `  ${c.in_flight.length} in flight ${glyph.sep} ${c.intake.length} in intake ${glyph.sep} ${c.blocked.length} blocked`, o.color)];
  for (const t of c.in_flight.slice(0, ROWS.crew)) {
    lines.push(`  ${paint("gold", glyph.working, o.color)} ${paint("white", t.title, o.color)} ${paint("muted", `${glyph.sep} ${[t.project, t.state].filter(Boolean).join(` ${glyph.sep} `)}`, o.color)}`);
  }
  return [...lines, ...more(c.in_flight.length, Math.min(c.in_flight.length, ROWS.crew), o)];
}

const STATUS_GLYPH = { working: glyph.working, blocked: glyph.blocked, idle: glyph.idle, done: glyph.done, unknown: glyph.idle } as const;

function sessionLines(p: Packet, o: LaunchOptions): string[] {
  const gone = unavailable(p.sessions, o);
  if (gone || !p.sessions.data) return [gone ?? paint("muted", "  reading…", o.color)];
  const rows = p.sessions.data.rows;
  if (rows.length === 0) return [paint("muted", "  no agent sessions", o.color)];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const lines = [paint("muted", `  ${count("working")} working ${glyph.sep} ${count("blocked")} blocked ${glyph.sep} ${count("idle") + count("done")} idle`, o.color)];
  for (const r of rows.slice(0, ROWS.sessions)) {
    const where = r.project ?? r.workspace ?? (r.cwd ? tilde(r.cwd) : "");
    lines.push(`  ${STATUS_GLYPH[r.status]} ${paint("white", r.agent ?? "agent", o.color)} ${paint("muted", `${glyph.sep} ${where}${r.title ? ` ${glyph.sep} ${r.title}` : ""}`, o.color)}`);
  }
  return [...lines, ...more(rows.length, Math.min(rows.length, ROWS.sessions), o)];
}

function decisionLines(p: Packet, o: LaunchOptions): string[] {
  const rows = p.decisions.data;
  if (rows.length === 0) return [paint("muted", "  nothing waiting on you", o.color)];
  return [
    ...rows.slice(0, ROWS.decisions).map((d) => `  ${glyph.blocked} ${paint("white", d.title, o.color)}${d.reason ? paint("muted", ` ${glyph.sep} ${d.reason}`, o.color) : ""}`),
    ...more(rows.length, Math.min(rows.length, ROWS.decisions), o),
  ];
}

function quotaLine(q: QuotaLine, o: LaunchOptions): string {
  const label = `${q.provider}${q.window ? ` ${glyph.sep} ${q.window}` : ""}`.padEnd(17);
  if (q.left_pct === null || q.state === "reset" || q.state === "dead" || q.state === "not_connected") {
    const failing = q.state === "dead";
    const text = q.state === "reset" ? `reset${q.resets_at ? ` ${age(q.resets_at, o.now)} ago` : ""}, waiting for a reading` : shortNote(q.note ?? q.state.replace("_", " "));
    return `  ${paint("white", label, o.color)}${failing ? paint("crimson", `${glyph.failing} ${text}`, o.color) : paint("muted", text, o.color)}`;
  }
  const left = `${q.left_pct}% left`;
  const resets = q.resets_at ? ` ${glyph.sep} resets ${until(q.resets_at, o.now)}` : "";
  const stamp = q.updated_at ? ` ${glyph.sep} ${age(q.updated_at, o.now)}` : "";
  if (q.state === "stale") return `  ${paint("white", label, o.color)}${paint("gold", `${left}${resets}${stamp} ${glyph.sep} stale`, o.color)}`;
  return `  ${paint("white", label, o.color)}${paint("white", left, o.color)}${paint("muted", `${resets}${stamp}`, o.color)}`;
}

function recentLines(p: Packet, o: LaunchOptions): string[] {
  const rows = p.recent.data.slice(0, ROWS.recent);
  if (rows.length === 0) return [paint("muted", "  nothing recorded yet", o.color)];
  const width = Math.min(12, Math.max(...rows.map((r) => (r.project ?? "—").length)));
  return rows.map((r) => `  ${paint("muted", age(r.at, o.now).padStart(3), o.color)} ${paint("muted", (r.project ?? "—").padEnd(width), o.color)} ${paint("white", r.text, o.color)}`);
}

function identityLines(p: Packet, o: LaunchOptions): string[] {
  const i = p.instance;
  const row = (k: string, v: string, tone: Tone = "white") => `${paint("muted", k.padEnd(8), o.color)}${paint(tone, v, o.color)}`;
  return [
    paint("white", `${i.org} · ${i.instance}`, o.color, true),
    row("machine", i.machine),
    row("kinas", i.version),
    row("store", tilde(i.store)),
    row("root", tilde(i.root)),
    row("harness", i.harness ?? "not detected", i.harness ? "white" : "muted"),
    row("model", i.model ?? "not set", i.model ? "white" : "muted"),
    row("herdr", i.herdr, p.sessions.state === "ok" ? "white" : "muted"),
    row("packet", ago(p.generated_at, o.now), "muted"),
  ];
}

function Panel({ width, o, children }: { width: number; o: LaunchOptions; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={o.color ? "#00549E" : undefined} paddingX={1}>
      {children}
    </Box>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <Line key={i}>{l}</Line>
      ))}
    </>
  );
}

function footer(p: Packet, o: LaunchOptions): string {
  const c = packetCounts(p);
  const sessions = c.sessions === null ? "herdr not running" : plural(c.sessions, "session");
  const head = paint("muted", `${plural(c.projects, "project")} ${glyph.sep} ${sessions} ${glyph.sep} `, o.color);
  const decisions = c.decisions > 0 ? paint("crimson", `${plural(c.decisions, "decision")} waiting on you`, o.color, true) : paint("muted", "0 decisions", o.color);
  return `${head}${decisions}${paint("muted", ` ${glyph.sep} kinas --help for commands`, o.color)}`;
}

function Launch({ p, o }: { p: Packet; o: LaunchOptions }) {
  const width = Math.min(o.columns, MAX_COLUMNS);
  const sideBySide = width >= SIDE_BY_SIDE_MIN;
  const right = sideBySide ? width - LEFT_WIDTH - 1 : width;
  return (
    <Box flexDirection="column" width={width}>
      <Text> </Text>
      <Box flexDirection="row" marginLeft={2}>
        {width >= WITH_LOGO_MIN && (
          <Box flexDirection="column" marginRight={3}>
            {logoLines(o.color).map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" justifyContent="center">
          {bannerLines(o.color).map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          <Text>{accentLine(BANNER_WIDTH, o.color)}</Text>
          <Line>{paint("muted", `${p.instance.org} · ${p.instance.instance}`, o.color)}</Line>
        </Box>
      </Box>
      <Text> </Text>
      <Box flexDirection={sideBySide ? "row" : "column"} gap={sideBySide ? 1 : 0}>
        <Panel width={sideBySide ? LEFT_WIDTH : width} o={o}>
          <Heading title="Kinas" o={o} />
          <Lines lines={identityLines(p, o)} />
        </Panel>
        <Panel width={right} o={o}>
          <Heading title="Projects" section={p.projects} o={o} />
          <Lines lines={projectLines(p, o)} />
          <Heading title="Crew" section={p.crew} o={o} />
          <Lines lines={crewLines(p, o)} />
          <Heading title="Sessions" section={p.sessions} o={o} />
          <Lines lines={sessionLines(p, o)} />
          <Heading title="Decisions" o={o} />
          <Lines lines={decisionLines(p, o)} />
          <Heading title="Quotas" o={o} />
          <Lines lines={p.quotas.data.map((q) => quotaLine(q, o))} />
          <Heading title="Recent" o={o} />
          <Lines lines={recentLines(p, o)} />
        </Panel>
      </Box>
      <Line>{` ${footer(p, o)}`}</Line>
    </Box>
  );
}

export function renderLaunch(packet: Packet, options: LaunchOptions): string {
  const columns = Math.min(options.columns, MAX_COLUMNS);
  return `${renderToString(<Launch p={packet} o={{ ...options, columns }} />, { columns })}\n`;
}
