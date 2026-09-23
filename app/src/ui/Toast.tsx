import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "./Button.tsx";
import "./Toast.css";

// DESIGN.md §4 Toast: bottom centre, 3 s, one line, one optional action. Placement is the caller's; this is the box.

export function Toast({ kind, action, children, className, ...rest }: { kind?: "error"; action?: { label: string; onClick: () => void }; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `ui-toast ${className}` : "ui-toast"} role="status" data-kind={kind} {...rest}>
      <span>{children}</span>
      {action && (
        <Button kind="text" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** DESIGN.md §4 Empty state: one sentence and, if there is something to do, one action. */
export function EmptyState({ action, children, ...rest }: { action?: { label: string; onClick: () => void }; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ui-empty" {...rest}>
      <span>{children}</span>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
