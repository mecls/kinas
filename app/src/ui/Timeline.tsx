import type { ReactNode } from "react";
import { Dot, Tag } from "./Dot.tsx";
import { BADGE, type BadgeState } from "./StatusBadge.tsx";
import "./Timeline.css";

// DESIGN.md §4 Timeline. An item's state colours its dot as the badge table does; an "order" is what the captain
// typed into a worker's pane, in --ink with the tag.

export interface TimelineItem {
  time: string;
  text: ReactNode;
  state: BadgeState | "order";
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ul className="ui-timeline">
      {items.map((item, i) => (
        <li key={i}>
          <span className="ui-timeline-time">{item.time}</span>
          {item.state === "order" ? <Dot color="--ink" /> : <Dot color={BADGE[item.state].color} kind={BADGE[item.state].kind} />}
          <span className="ui-timeline-text">
            {item.text}
            {item.state === "order" && <Tag>order</Tag>}
          </span>
        </li>
      ))}
    </ul>
  );
}
