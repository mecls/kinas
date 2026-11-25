import type { ReactNode } from "react";
import { DetachedBadge, StatusBadge, type BadgeState, type DetachedState } from "./StatusBadge.tsx";
import "./TerminalChrome.css";

// DESIGN.md §4 Terminal chrome. It is mounted as a sibling above the pane, never around it (the terminal is never
// remounted). Detach waits for a Herdr-CLI door; Copy is the existing copy path. The badge is drawn only when there is
// a state to show — a crew worker's pane (1.4): nothing is drawn from a guess. (1.14) While the pane is not attached to
// the VPS, `detached` says so before anything else.

export function TerminalChrome({
  session,
  state,
  profile,
  actions,
  detached,
}: {
  session: string;
  state?: BadgeState;
  profile?: ReactNode;
  actions?: { label: string; onClick: () => void }[];
  detached?: { state: DetachedState; since?: string | null } | null;
}) {
  return (
    <div className="ui-termchrome">
      <span className="ui-termchrome-session">{session}</span>
      {detached && <DetachedBadge state={detached.state} since={detached.since} />}
      {state && <StatusBadge state={state} />}
      {profile && <span className="ui-ink2">{profile}</span>}
      {actions && actions.length > 0 && (
        <span className="ui-termchrome-acts">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
