import type { PaneState } from "../api.ts";
import type { Machine } from "../shell/connection.ts";
import type { Attach } from "../terminal/reattach.ts";
import { lisbonClock } from "../usage/format.ts";
import type { DetachedState } from "../ui/index.ts";

// The Work page's chrome (DESIGN.md 4 Terminal chrome; 1.4, 1.14): what it names and, on a VPS, whether the pane is
// attached. Herdr's remote client says nothing about its own connection, so the badge is the pane's own news — started,
// first drawn, exited — joined with the machine state the status bar shows, so the chrome and the bar never disagree.

/** `vps-1 · default · shop` on a VPS; `default · shop` on this Mac; the session alone with no workspace. */
export function chromeSession(pane: PaneState | null): string {
  if (!pane) return "";
  return [pane.place, pane.session, pane.workspace].filter((p): p is string => !!p).join(" · ");
}

export interface Detached {
  state: DetachedState;
  /** `14:02`, Lisbon's clock, for `unreachable since`. */
  since: string | null;
}

/**
 * The detached badge; null on this Mac and while the pane is attached and the machine answers. The machine's
 * `reconnecting` before anything was tried (at start) is not news: only a door that failed since its last success is.
 */
export function detachedOf(place: string | null, attach: Attach, machine: Machine | null, now: number): Detached | null {
  if (place === null) return null;
  if (machine?.state === "unreachable") return { state: "unreachable", since: machine.since === null ? null : lisbonClock(machine.since, now) };
  if (attach === "connecting") return { state: "connecting", since: null };
  if (attach === "detached") return { state: "reconnecting", since: null };
  if (machine?.state === "reconnecting" && machine.failing) return { state: "reconnecting", since: null };
  return null;
}
