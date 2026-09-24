import { useEffect, useState } from "react";
import { crewPaneState, type CrewWord, type PaneState } from "../api.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import { copyTerminalSelection, focusTerminal } from "../shell/focus.ts";
import { Terminal } from "../terminal/Terminal.tsx";
import { TerminalChrome, type BadgeState } from "../ui/index.ts";

/** The chrome's badge for a worker's word; a word the badge does not draw yet (failed, paused, unknown, gone) has none. */
const BADGE_OF: Partial<Record<CrewWord, BadgeState>> = {
  queued: "queued",
  working: "working",
  "needs decision": "decision",
  blocked: "blocked",
  "CI red": "red",
  "PR open": "pr",
  ready: "ready",
  done: "done",
};

/** How often the chrome asks what the pane is while the Work page shows (build spec §4 Work). */
const PANE_POLL_MS = 5_000;

// The terminal under its chrome (DESIGN.md §4 Terminal chrome; build-spec §4 Work). The reader used to split this page
// with it (reader R32); since 2026-09-18 it is a panel on the right of the whole window, laid out by the shell
// (App.tsx, styles/shell.css), so opening, closing, resizing and expanding it never touch this tree. That is the point:
// a new wrapper around <Terminal> would remount it, restart the PTY and drop Herdr's client (reader R31, Build 1 R33).
// The chrome is therefore a sibling above `.work-terminal`, never its parent, and it is rendered from the first frame
// — appearing later would shift the pane's place among its siblings, and React would mount it again. The terminal
// refits through its own ResizeObserver. `.work-terminal` is how the shell finds the pane to focus it.
//
// Amended 2026-09-24 (the first mate): the chrome reads what Herdr reports — the session, then the focused workspace's
// label (a worker's tab label for a worker's pane), the task's badge only on a worker's pane, and `claude` when Herdr sees
// it in the foreground (crew_pane_state, every 5 s while this page shows). Nothing is drawn from a guess: the badge is
// gone once Herdr's view is 15 s old.
export function WorkPage({ active, shortcuts }: { active: boolean; shortcuts: Shortcuts }) {
  const [pane, setPane] = useState<PaneState | null>(null);
  useEffect(() => {
    const read = () => void crewPaneState().then(setPane, () => {});
    read();
    if (!active) return;
    const timer = window.setInterval(read, PANE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  const badge = pane?.word && !pane.stale ? BADGE_OF[pane.word] : undefined;
  return (
    <div className="work">
      <TerminalChrome
        session={pane ? (pane.workspace ? `${pane.session} · ${pane.workspace}` : pane.session) : ""}
        state={badge}
        profile={pane?.profile ?? undefined}
        // Copy, then the keys back to the pane: the click took them.
        actions={[{ label: "Copy", onClick: () => void copyTerminalSelection().finally(focusTerminal) }]}
      />
      <div className="work-terminal">
        <Terminal active={active} shortcuts={shortcuts} />
      </div>
    </div>
  );
}
