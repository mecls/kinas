import type { ReactNode } from "react";
import { SegBar, type Segments } from "./Bar.tsx";
import { Chip, Tag, type Category } from "./Dot.tsx";
import { ChevronRightIcon } from "./icons.tsx";
import { Badges, StatusBadge, type BadgeState } from "./StatusBadge.tsx";
import "./ProgressRow.css";

// DESIGN.md §4 Progress row. A folder with no overnight activity says so in --ink-2 and draws no bar (`seg` absent);
// internal folders carry the "internal" tag and sort last (the caller's job).

export function ProgressRow({
  cat,
  name,
  internal = false,
  event,
  seg,
  badges = [],
  selected = false,
  onSelect,
}: {
  cat: Category;
  name: string;
  internal?: boolean;
  event: ReactNode;
  seg?: Segments;
  badges?: { state: BadgeState; count: number }[];
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button type="button" className="ui-progress-row" role="option" aria-selected={selected} data-quiet={seg ? undefined : "true"} onClick={onSelect}>
      <Chip cat={cat} />
      <span className="ui-progress-name">
        <span>{name}</span>
        {internal && <Tag>internal</Tag>}
        <span className="ui-progress-event">{event}</span>
      </span>
      <span className="ui-progress-bar">{seg ? <SegBar {...seg} /> : <span />}</span>
      <Badges>
        {badges.map((b) => (
          <StatusBadge key={b.state} state={b.state} count={b.count} />
        ))}
      </Badges>
      <span className="ui-progress-chev">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

/** The card the rows stack in; a listbox, so a row is an option. */
export function ProgressList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-plist" role="listbox" aria-label={label}>
      {children}
    </div>
  );
}
