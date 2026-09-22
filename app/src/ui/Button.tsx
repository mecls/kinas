import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

// DESIGN.md §4 Button: primary (the accent), secondary (a surface, the default) or text (quiet); --hit tall on the
// Mac. The label names exactly what happens ("Approve plan", not "Submit"), and the toast that follows uses the same
// verb. `hint` is the key that does the same, shown as a Kbd — only for a key keymap.md lists.

export type ButtonKind = "primary" | "secondary" | "text";

export function Button({
  kind = "secondary",
  hint,
  children,
  className,
  ...rest
}: { kind?: ButtonKind; hint?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={className ? `ui-button ${className}` : "ui-button"} data-kind={kind} {...rest}>
      {children}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}
