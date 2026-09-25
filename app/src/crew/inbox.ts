import type { CrewDecision, CrewSnapshot } from "../api.ts";

// The Inbox's words (build spec §4 Inbox page; DESIGN.md 1.7; mockup inbox.html): pure, so inbox.test.ts holds them.

export interface InboxGroups {
  /** A worker's open decision, keyed. */
  decisions: CrewDecision[];
  /** A task Firstmate holds for the captain, keyed by its own id. */
  held: CrewDecision[];
  /** Information only (slice 9): never counted, never answered. */
  reconcile: string[];
}

/** Rust sends the open decisions newest first; the groups keep that order. */
export function inboxGroups(c: CrewSnapshot): InboxGroups {
  return {
    decisions: c.decisions.filter((d) => d.verb !== "captain-hold"),
    held: c.decisions.filter((d) => d.verb === "captain-hold"),
    reconcile: c.reconcile,
  };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** "Copied 15:02 — paste it into the first mate's pane", or null before a copy. */
export function copiedText(copiedAt: number | null): string | null {
  return copiedAt === null ? null : `Copied ${clock(copiedAt)} — paste it into the first mate's pane`;
}

/** "just now", "12 min ago", "5 h ago", "2 d ago". */
export function ageText(openedAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - openedAt) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** The task's title as filed, else its id. */
export const titleOf = (d: CrewDecision) => d.task_title ?? d.task_id;
