// The numbers the launch footer and `kinas context` lead with.

import type { Packet } from "./packet.ts";

export interface PacketCounts {
  projects: number;
  /** null when Herdr could not be read. */
  sessions: number | null;
  decisions: number;
}

export function packetCounts(p: Packet): PacketCounts {
  return {
    projects: p.projects.data.length,
    sessions: p.sessions.state === "ok" && p.sessions.data ? p.sessions.data.rows.length : null,
    decisions: p.decisions.data.length,
  };
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
