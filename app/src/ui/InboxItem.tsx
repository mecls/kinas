import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Chip, type Category } from "./Dot.tsx";
import "./InboxItem.css";

// DESIGN.md §4 Inbox item: the question, then what its source carries — a quiet context line (1.4: the crew's task,
// key and age), the recommendation — and three actions, Approve (primary), Answer, Deny (text), with their keys A, R
// and D drawn beside them (keymap.md: they act while the item has focus, which its caller wires). 1.7: Answer and Deny
// open a text box whose button is Copy and go, with one quiet hint line; after a copy the item says so in one quiet
// line and keeps its actions. The box owns its keys: Enter copies, ⇧Enter is a new line, Esc closes.

export const ANSWER_HINT = "Goes on the clipboard for the first mate's pane · Enter copies, ⇧Enter a new line, Esc closes";

export function InboxItem({
  cat,
  question,
  context,
  recommendation,
  approveLabel = "Approve",
  approveHint,
  keys = false,
  state = "open",
  answer = "",
  copyDisabled = false,
  copied,
  compact = false,
  onAnswerChange,
  onApprove,
  onAnswer,
  onDeny,
  onCopy,
  onCancel,
  className,
  ...rest
}: {
  cat?: Category;
  question: ReactNode;
  /** One quiet line under the question: the crew's `<title> · <key> · <age>`. */
  context?: ReactNode;
  recommendation?: ReactNode;
  approveLabel?: string;
  /** The key drawn on Approve alone (the plan story); `keys` draws A, R and D on all three. */
  approveHint?: string;
  keys?: boolean;
  /** `answering`: the text box is open in place of the actions. */
  state?: "open" | "answering";
  answer?: string;
  copyDisabled?: boolean;
  /** `Copied 15:02 — paste it into the first mate's pane`, under the item. */
  copied?: string;
  compact?: boolean;
  onAnswerChange?: (text: string) => void;
  onApprove: () => void;
  onAnswer: () => void;
  onDeny: () => void;
  onCopy?: () => void;
  onCancel?: () => void;
} & Omit<HTMLAttributes<HTMLDivElement>, "onCopy">) {
  const box = useRef<HTMLTextAreaElement>(null);
  const answering = state === "answering";
  // The box takes the keys the moment it opens.
  useEffect(() => {
    if (answering) box.current?.focus({ preventScroll: true });
  }, [answering]);

  const onBoxKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Every key typed here is the answer's (A, R and D are letters in the box); none reaches the item's own keys.
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!copyDisabled) onCopy?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  };

  return (
    <div
      className={className ? `ui-inbox-item ${className}` : "ui-inbox-item"}
      data-state={state}
      data-compact={compact ? "true" : undefined}
      {...rest}
    >
      <div className="ui-inbox-main">
        <div className="ui-inbox-question">
          {cat !== undefined && <Chip cat={cat} />}
          <span>{question}</span>
        </div>
        {context && <p className="ui-inbox-rec ui-inbox-context">{context}</p>}
        {recommendation && <p className="ui-inbox-rec">{recommendation}</p>}
        {answering && (
          <div className="ui-inbox-answer">
            <textarea
              ref={box}
              className="inbox-answer"
              aria-label="Your answer"
              value={answer}
              onChange={(e) => onAnswerChange?.(e.target.value)}
              onKeyDown={onBoxKey}
            />
            <div className="ui-inbox-answer-row">
              <span className="ui-inbox-hint">{ANSWER_HINT}</span>
              <Button kind="primary" disabled={copyDisabled} onClick={() => onCopy?.()}>
                Copy and go
              </Button>
            </div>
          </div>
        )}
        {copied && <p className="ui-inbox-rec inbox-copied">{copied}</p>}
      </div>
      {!answering && (
        <div className="ui-inbox-acts">
          <Button kind="text" hint={keys ? "D" : undefined} onClick={onDeny}>
            Deny
          </Button>
          <Button hint={keys ? "R" : undefined} onClick={onAnswer}>
            Answer
          </Button>
          <Button kind="primary" hint={keys ? "A" : approveHint} onClick={onApprove}>
            {approveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Inbox({ children }: { children: ReactNode }) {
  return <div className="ui-inbox">{children}</div>;
}
