// `kinas context`: the operator's summary — the counts, what is waiting on you, and what changed recently.

import { glyph, paint } from "@kinas/commands/theme";
import { packetCounts, plural } from "./counts.ts";
import type { Packet } from "./packet.ts";
import { age } from "./time.ts";

export function renderOperator(p: Packet, color: boolean): string {
  const c = packetCounts(p);
  const sessions = c.sessions === null ? (p.sessions.note ?? "herdr: not read") : plural(c.sessions, "session");
  const lines = [
    `${paint("blue", `${p.instance.org} · ${p.instance.instance}`, color, true)}  ${paint("muted", [plural(c.projects, "project"), sessions, plural(c.decisions, "decision")].join(` ${glyph.sep} `), color)}`,
  ];
  // Packet version 2 (the first mate): the features in progress, after the counts, only when there are some.
  if (p.features.data.length > 0) {
    lines.push("", paint("blue", "Features in progress", color, true));
    for (const f of p.features.data) lines.push(`  ${paint("white", `${f.project} · ${f.slug}`, color)}${paint("muted", `: ${f.line}`, color)}`);
  }
  lines.push("", paint("blue", "Decisions", color, true));
  if (p.decisions.data.length === 0) {
    lines.push(`  ${paint("muted", "Nothing is waiting on you.", color)}`);
  } else {
    for (const d of p.decisions.data) {
      lines.push(`  ${glyph.blocked} ${paint("white", d.title, color)}${d.reason ? paint("muted", ` — ${d.reason}`, color) : ""}`);
    }
  }

  lines.push("", paint("blue", "Recent", color, true));
  if (p.recent.data.length === 0) {
    lines.push(`  ${paint("muted", "Nothing recorded yet.", color)}`);
  } else {
    const width = Math.max(...p.recent.data.map((r) => (r.project ?? "—").length));
    for (const r of p.recent.data) {
      lines.push(`  ${paint("muted", age(r.at, p.generated_at).padStart(3), color)}  ${paint("muted", (r.project ?? "—").padEnd(width), color)}  ${paint("white", r.text, color)}`);
    }
  }
  if (c.decisions > 0) lines.push("", paint("crimson", `${plural(c.decisions, "decision")} waiting on you`, color));
  return `${lines.join("\n")}\n`;
}
