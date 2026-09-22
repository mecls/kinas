import type { ReactNode } from "react";

// The design system's icon set (DESIGN.md §4; design/preview.html's sprite, lines 311–327): fifteen strokes on a
// 16-unit grid, drawn in the current colour at `--icon` (16) by default and `--icon-sm` (14) beside a row action.
// Inline SVG, no package — a dozen paths are not worth a pinned dependency (Build 1 R6). The older Lucide drawings
// the reader and the sidebar still use live in app/src/icons.tsx until those surfaces are rebuilt on this set.

export type IconSize = "md" | "sm";

function Icon({ size = "md", title, children }: { size?: IconSize; title?: string; children: ReactNode }) {
  return (
    <svg className="ui-icon" data-size={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

type Props = { size?: IconSize; title?: string };

export const HomeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H10v-4H6v4H3a.5.5 0 0 1-.5-.5z" />
  </Icon>
);
export const TerminalIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="m5 7 2 1.5L5 10M8.5 10.5H11" />
  </Icon>
);
export const CrewIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="2" y="3" width="3.5" height="10" rx="1" />
    <rect x="6.25" y="3" width="3.5" height="7" rx="1" />
    <rect x="10.5" y="3" width="3.5" height="5" rx="1" />
  </Icon>
);
export const InboxIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2 9h3.5l1 1.5h3l1-1.5H14M3.5 3.5h9L14 9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9z" />
  </Icon>
);
export const GaugeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0M8 11.5l2.5-3" />
  </Icon>
);
export const FileIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
  </Icon>
);
export const GearIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);
export const PlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const ChevronRightIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);
export const ChevronLeftIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m10 3.5-4.5 4.5 4.5 4.5" />
  </Icon>
);
export const ChevronDownIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);
export const CheckIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);
export const CloseIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Icon>
);
export const ServerIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
    <path d="M5 4.75h.01M5 11.25h.01" />
  </Icon>
);
export const SearchIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);
export const InfoIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.5v3.5M8 5h.01" />
  </Icon>
);
