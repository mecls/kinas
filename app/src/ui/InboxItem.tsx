import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Chip, type Category } from "./Dot.tsx";
import "./InboxItem.css";

// DESIGN.md §4 Inbox item, compact: the question, the recommendation in one line, three actions. On the Mac the
// keys are A, R and D when the item is focused — a later build binds them in keymap.md first; this pass draws the
// hint on Approve only where the caller passes one.

export function InboxItem({
  cat,
  question,
  recommendation,
  approveLabel,
  approveHint,
  onApprove,
  onAnswer,
  onDeny,
}: {
  cat: Category;
  question: ReactNode;
  recommendation?: ReactNode;
  approveLabel: string;
  approveHint?: string;
  onApprove: () => void;
  onAnswer: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="ui-inbox-item">
      <div>
        <div className="ui-inbox-question">
          <Chip cat={cat} />
          <span>{question}</span>
        </div>
        {recommendation && <p className="ui-inbox-rec">{recommendation}</p>}
      </div>
      <div className="ui-inbox-acts">
        <Button kind="text" onClick={onDeny}>
          Deny
        </Button>
        <Button onClick={onAnswer}>Answer</Button>
        <Button kind="primary" hint={approveHint} onClick={onApprove}>
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}

export function Inbox({ children }: { children: ReactNode }) {
  return <div className="ui-inbox">{children}</div>;
}
