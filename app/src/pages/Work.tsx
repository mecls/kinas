import { useCallback, useEffect, useState } from "react";
import { crewPaneState, type PaneState } from "../api.ts";
import { paneBadge } from "../crew/board.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import type { Machine } from "../shell/connection.ts";
import { copyTerminalSelection, focusTerminal } from "../shell/focus.ts";
import type { Attach } from "../terminal/reattach.ts";
import { Terminal } from "../terminal/Terminal.tsx";
import { TerminalChrome } from "../ui/index.ts";
import { chromeSession, detachedOf } from "./workChrome.ts";

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
//
// Amended 2026-11-24 (the factory in the cloud, DESIGN.md 1.14): with the agents on a VPS the chrome names it first —
// `vps-1 · default · shop` — and, while the pane is not attached, says so (`connecting`, `reconnecting`, `unreachable
// since 14:02`) with the pane dimmed; `machine` is the status bar's own reading, so the two never disagree.
export function WorkPage({ active, shortcuts, machine }: { active: boolean; shortcuts: Shortcuts; machine: Machine | null }) {
  const [pane, setPane] = useState<PaneState | null>(null);
  const [attach, setAttach] = useState<Attach>("connecting");
  useEffect(() => {
    const read = () => void crewPaneState().then(setPane, () => {});
    read();
    if (!active) return;
    const timer = window.setInterval(read, PANE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  // A new attach is news for the chrome now, not at the next poll: the place may have changed with it.
  const onAttach = useCallback((a: Attach) => {
    setAttach(a);
    void crewPaneState().then(setPane, () => {});
  }, []);

  const badge = paneBadge(pane);
  const detached = detachedOf(pane?.place ?? null, attach, machine, Date.now());
  return (
    <div className="work">
      <TerminalChrome
        session={chromeSession(pane)}
        state={badge}
        profile={pane?.profile ?? undefined}
        detached={detached}
        // Copy, then the keys back to the pane: the click took them.
        actions={[{ label: "Copy", onClick: () => void copyTerminalSelection().finally(focusTerminal) }]}
      />
      <div className={detached ? "work-terminal term-detached" : "work-terminal"}>
        <Terminal active={active} shortcuts={shortcuts} onAttach={onAttach} />
      </div>
    </div>
  );
}
