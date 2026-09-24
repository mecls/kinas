// The component library (DESIGN.md §4, §9): every component once, tokens only, a story per state in ./stories.
// A page imports from here and nowhere else.

import "./base.css";

export { Button, Kbd, type ButtonKind } from "./Button.tsx";
export { Dot, Chip, Tag, type Category, type DotKind } from "./Dot.tsx";
export { ChangeMark, countLabel, type ChangeKind } from "./ChangeMark.tsx";
export { StatusBadge, Badges, BADGE, type BadgeState } from "./StatusBadge.tsx";
export { Bar, SegBar, toneOf, type Tone, type Segments } from "./Bar.tsx";
export { Gauge, Gauges, formatUsed } from "./Gauge.tsx";
export { MetricRow, Rows } from "./MetricRow.tsx";
export { SectionHeader, Section, TitleRow } from "./SectionHeader.tsx";
export { Card, Lane } from "./Card.tsx";
export { Table, type Column } from "./Table.tsx";
export { ProgressRow, ProgressList } from "./ProgressRow.tsx";
export { InboxItem, Inbox } from "./InboxItem.tsx";
export { Timeline, type TimelineItem } from "./Timeline.tsx";
export { Toast, EmptyState } from "./Toast.tsx";
export { TerminalChrome } from "./TerminalChrome.tsx";
export { PanelHeader, PanelBody, PanelFooter, QuestionCard, ChecksList, type Check } from "./Panel.tsx";
export { Wordmark, NavItem, NavHeading, ConnectionRow, type ConnectionState } from "./Nav.tsx";
export { Field, Input, Switch } from "./Field.tsx";
export { AccentField } from "./AccentField.tsx";
export { Menu, type MenuItem, type MenuDivider, type MenuEntry } from "./Menu.tsx";
export { TabStrip, type TabStripTab } from "./TabStrip.tsx";
export * from "./icons.tsx";
