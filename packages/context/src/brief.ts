// The brief convention (CLI v0 brief): any brief a Kinas command writes into Firstmate's intake begins with the
// packet's Conventions and Projects sections, so a crewmate starts on the rails. No v0 command files briefs yet;
// the first one that does calls this.

import type { Packet } from "./packet.ts";
import { renderConventions, renderProjects } from "./render-agent.ts";

export function briefPreamble(packet: Packet): string {
  return `${renderConventions(packet)}\n\n${renderProjects(packet)}\n`;
}
