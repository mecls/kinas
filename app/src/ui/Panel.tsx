import type { ReactNode } from "react";
import { Chip, Dot, type Category } from "./Dot.tsx";
import { BADGE, StatusBadge, type BadgeState } from "./StatusBadge.tsx";
import "./Panel.css";

// The right panel's task detail (DESIGN.md §5 Crew) as the preview draws it: PanelHeader, PanelBody, PanelFooter,
// QuestionCard and ChecksList. The panel that holds them is the shell's `aside.shell-panel`.

export function PanelHeader({ cat, folder, title, state }: { cat: Category; folder: string; title: ReactNode; state?: BadgeState }) {
  return (
    <div className="ui-panel-h">
      <div className="ui-panel-crumb">
        <Chip cat={cat} />
        <span>{folder}</span>
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
