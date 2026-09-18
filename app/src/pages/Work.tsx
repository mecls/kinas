import type { Shortcuts } from "../settings/shortcuts.ts";
import { Terminal } from "../terminal/Terminal.tsx";

// The terminal, and nothing else. The reader used to split this page with it (reader R32); since 2026-09-18 it is a
// panel on the right of the whole window, laid out by the shell (App.tsx, styles/shell.css), so opening, closing,
// resizing and expanding it never touch this tree. That is the point: a new wrapper around <Terminal> would remount
// it, restart the PTY and drop Herdr's client (reader R31, Build 1 R33). The terminal refits through its own
// ResizeObserver while the shell's divider moves. `.work-terminal` is how the shell finds the pane to focus it.
export function WorkPage({ active, shortcuts }: { active: boolean; shortcuts: Shortcuts }) {
  return (
    <div className="work">
      <div className="work-terminal">
        <Terminal active={active} shortcuts={shortcuts} />
      </div>
    </div>
  );
}
