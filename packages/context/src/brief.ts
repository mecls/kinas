// The brief convention (CLI v0 brief): a brief Kinas composes for the crew begins with the packet's Conventions and
// Projects sections, so a crewmate starts on the rails. Amended 2026-09-25 (the first mate, ADR 0016): Kinas writes
// nothing into Firstmate's home, its intake included — a brief reaches Firstmate only through the first mate's chat,
// pasted by the captain (ADR 0017). No command composes one yet; the first that does calls this.

import type { Packet } from "./packet.ts";
import { renderConventions, renderProjects, shown } from "./render-agent.ts";

export function briefPreamble(packet: Packet): string {
  const p = shown(packet);
  return `${renderConventions(p)}\n\n${renderProjects(p)}\n`;
}
