import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Chip, Dot, type Category } from "./Dot.tsx";
import { CloseIcon } from "./icons.tsx";
import { BADGE, StatusBadge, type BadgeState } from "./StatusBadge.tsx";
import "./Panel.css";

// The right panel's task detail (DESIGN.md §5 Crew) as the preview draws it: PanelHeader, PanelBody, PanelFooter,
// QuestionCard and ChecksList. The panel that holds them is the shell's `aside.shell-panel`.

/** `cat` absent: a lane named after a repository no client folder matches, with no chip (1.4). `onClose`: × in the
 *  crumb row, which closes the panel. */
export function PanelHeader({ cat, folder, title, state, onClose }: { cat?: Category; folder: string; title: ReactNode; state?: BadgeState; onClose?: () => void }) {
  return (
    <div className="ui-panel-h">
      <div className="ui-panel-crumb">
        {cat !== undefined && <Chip cat={cat} />}
        <span>{folder}</span>
        {onClose && (
          <Button kind="text" className="ui-panel-close" aria-label="Close the panel" title="Close the panel" onClick={onClose}>
            <CloseIcon />
          </Button>
        )}
      </div>
      <h3>{title}</h3>
      {state && <StatusBadge state={state} />}
    </div>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="ui-panel-b">{children}</div>;
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="ui-panel-f">{children}</div>;
}

export function QuestionCard({ question, recommendation }: { question: ReactNode; recommendation?: ReactNode }) {
  return (
    <div className="ui-qbox">
      <p>{question}</p>
      {recommendation && <p className="ui-qbox-rec">{recommendation}</p>}
    </div>
  );
}

export interface Check {
  state: BadgeState;
  name: ReactNode;
  result?: ReactNode;
  error?: string;
}

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="ui-checks">
      {checks.map((c, i) => (
        <li key={i}>
          <Dot color={BADGE[c.state].color} kind={BADGE[c.state].kind} />
          <span>{c.name}</span>
          {c.result && <span className="ui-checks-result">{c.result}</span>}
          {c.error && <span className="ui-checks-err">{c.error}</span>}
        </li>
      ))}
    </ul>
  );
}
