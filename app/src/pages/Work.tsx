import { useEffect, useState } from "react";
import { paneSession } from "../api.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import { copyTerminalSelection, focusTerminal } from "../shell/focus.ts";
import { Terminal } from "../terminal/Terminal.tsx";
import { TerminalChrome } from "../ui/index.ts";

// The terminal under its chrome (DESIGN.md §4 Terminal chrome; build-spec §4 Work). The reader used to split this page
// with it (reader R32); since 2026-09-18 it is a panel on the right of the whole window, laid out by the shell
// (App.tsx, styles/shell.css), so opening, closing, resizing and expanding it never touch this tree. That is the point:
// a new wrapper around <Terminal> would remount it, restart the PTY and drop Herdr's client (reader R31, Build 1 R33).
// The chrome is therefore a sibling above `.work-terminal`, never its parent, and it is rendered from the first frame
// — appearing later would shift the pane's place among its siblings, and React would mount it again. The terminal
// refits through its own ResizeObserver. `.work-terminal` is how the shell finds the pane to focus it.
export function WorkPage({ active, shortcuts }: { active: boolean; shortcuts: Shortcuts }) {
  const [pane, setPane] = useState<{ session: string; shell: boolean } | null>(null);
  useEffect(() => {
    paneSession().then(setPane, () => {});
  }, []);

  return (
    <div className="work">
      <TerminalChrome
        session={pane?.session ?? ""}
        state={pane?.shell ? "stale" : "working"}
        profile={pane?.shell ? "plain shell" : undefined}
        // Copy, then the keys back to the pane: the click took them.
        actions={[{ label: "Copy", onClick: () => void copyTerminalSelection().finally(focusTerminal) }]}
      />
      <div className="work-terminal">
        <Terminal active={active} shortcuts={shortcuts} />
      </div>
    </div>
  );
}
