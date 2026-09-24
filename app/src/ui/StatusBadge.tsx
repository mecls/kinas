import type { ReactNode } from "react";
import { Dot, type DotKind } from "./Dot.tsx";
import "./StatusBadge.css";

// DESIGN.md §4's table, exactly: the word, the dot's kind and its colour per state. Solid is what the system is
// doing, a ring is waiting on a person, a cross is dead.

export type BadgeState = "queued" | "working" | "blocked" | "red" | "done" | "stale" | "dead" | "decision" | "pr" | "ready";

export const BADGE: Record<BadgeState, { word: string; color: string; kind: DotKind }> = {
  queued: { word: "queued", color: "--stale", kind: "solid" },
  working: { word: "working", color: "--meter", kind: "solid" },
  blocked: { word: "blocked", color: "--danger", kind: "solid" },
  red: { word: "CI red", color: "--danger", kind: "solid" },
  done: { word: "done", color: "--ok", kind: "solid" },
  stale: { word: "stale", color: "--stale", kind: "solid" },
  dead: { word: "dead", color: "--ink-3", kind: "cross" },
  decision: { word: "needs decision", color: "--warn", kind: "ring" },
  pr: { word: "PR open", color: "--meter", kind: "ring" },
  ready: { word: "ready", color: "--ok", kind: "ring" },
};

export function StatusBadge({ state, count }: { state: BadgeState; count?: number }) {
  const b = BADGE[state];
  return (
    <span className="ui-badge" data-state={state}>
      <Dot color={b.color} kind={b.kind} />
      {count !== undefined && (
        <>
          <span className="ui-badge-n">{count}</span>{" "}
        </>
      )}
      {b.word}
    </span>
  );
}

/** The crew's tool health (DESIGN.md 1.4): the same pill with its own words. */
export type HealthState = "installed" | "below_floor" | "missing" | "signed_in" | "signed_out";

const HEALTH: Record<HealthState, { word: string; color: string }> = {
  installed: { word: "installed", color: "--ok" },
  below_floor: { word: "below floor", color: "--warn" },
  missing: { word: "missing", color: "--danger" },
  signed_in: { word: "signed in", color: "--ok" },
  signed_out: { word: "not signed in", color: "--danger" },
};

/** A tool's health in Settings → Crew and on the Crew page; an optional tool that is missing is missing in --stale. */
export function HealthBadge({ state, optional = false }: { state: HealthState; optional?: boolean }) {
  const h = HEALTH[state];
  return (
    <span className="ui-badge" data-health={state}>
      <Dot color={optional && state === "missing" ? "--stale" : h.color} />
      {h.word}
    </span>
  );
}

/** A row of badges, right-aligned, as the progress row and the phone's folder rows use them. */
export function Badges({ children }: { children: ReactNode }) {
  return <span className="ui-badges">{children}</span>;
}
