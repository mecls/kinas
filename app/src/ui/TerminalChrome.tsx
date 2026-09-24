import type { ReactNode } from "react";
import { StatusBadge, type BadgeState } from "./StatusBadge.tsx";
import "./TerminalChrome.css";

// DESIGN.md §4 Terminal chrome. It is mounted as a sibling above the pane, never around it (the terminal is never
// remounted). Detach waits for a Herdr-CLI door; Copy is the existing copy path. The badge is drawn only when there is
// a state to show — a crew worker's pane (1.4): nothing is drawn from a guess.

export function TerminalChrome({ session, state, profile, actions }: { session: string; state?: BadgeState; profile?: ReactNode; actions?: { label: string; onClick: () => void }[] }) {
  return (
    <div className="ui-termchrome">
      <span className="ui-termchrome-session">{session}</span>
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
