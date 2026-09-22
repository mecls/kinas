import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Chip, Dot, Tag, type Category } from "./Dot.tsx";
import { ServerIcon } from "./icons.tsx";
import "./Nav.css";

// DESIGN.md §3.1: the sidebar's wordmark, its navigation rows, the client folders with their chips and the VPS row
// at the foot. A count is shown only when there is one (never "0").

export function Wordmark({ children = "kinas" }: { children?: ReactNode }) {
  return <div className="ui-word">{children}</div>;
}

export function NavItem({
  icon,
  label,
  current = false,
  count,
  tag,
  chip,
  className,
  ...rest
}: {
  icon?: ReactNode;
  label: ReactNode;
  current?: boolean;
  count?: number;
  tag?: string;
  chip?: Category;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={className ? `ui-nav ${className}` : "ui-nav"} aria-current={current ? "page" : undefined} {...rest}>
      {chip !== undefined ? <Chip cat={chip} /> : icon}
      <span className="ui-nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="ui-nav-count">{count}</span>}
      {tag && <Tag>{tag}</Tag>}
    </button>
  );
}

export function NavHeading({ children }: { children: ReactNode }) {
  return <h4 className="ui-nav-h">{children}</h4>;
}

export type ConnectionState = "connected" | "stale" | "error";

const CONNECTION: Record<ConnectionState, { color: string; kind: "solid" | "ring" }> = {
  connected: { color: "--ok", kind: "solid" },
  stale: { color: "--stale", kind: "solid" },
  error: { color: "--danger", kind: "solid" },
};

/** The VPS at the foot of the sidebar: the colour and the word say the same thing. */
export function ConnectionRow({ name, state, detail }: { name: ReactNode; state: ConnectionState; detail?: string }) {
  return (
    <div className="ui-machine" title={detail}>
      <ServerIcon />
      <span className="ui-nav-label">{name}</span>
      <Dot color={CONNECTION[state].color} kind={CONNECTION[state].kind} />
      <span className="ui-ink2">{state}</span>
    </div>
  );
}
