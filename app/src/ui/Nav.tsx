import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Kbd } from "./Button.tsx";
import { Chip, Tag, type Category } from "./Dot.tsx";
import { SearchIcon } from "./icons.tsx";
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

/**
 * The sidebar's search row (1.13, the interface polish, rule 19): under the wordmark, a magnifier, "Search" and the
 * palette's chord as a Kbd. A click opens the palette, the same one ⌘K opens.
 */
export function SearchRow({ chord, onClick }: { chord: string; onClick: () => void }) {
  return (
    <button type="button" className="ui-nav ui-search" onClick={onClick} title={`Search (${chord})`}>
      <SearchIcon />
      <span className="ui-nav-label">Search</span>
      <Kbd>{chord}</Kbd>
    </button>
  );
}

export function NavHeading({ children }: { children: ReactNode }) {
  return <h4 className="ui-nav-h ui-group-label">{children}</h4>;
}

/** The VPS's word, on the status bar since the interface polish (rule 22): the sidebar draws no machine row. */
export type ConnectionState = "connected" | "stale" | "error";

