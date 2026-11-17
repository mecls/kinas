import type { ReactNode } from "react";
import "./SettingsRow.css";

// DESIGN.md §4 Settings row (1.13, the interface polish): one setting — its label (--ink, 500) and a one-line
// description (--ink-2, --text-sm) on the left, its control on the right; a wide control (a path, a key, a list, a
// table) sits under the label at the row's full width. A section's rows share one Card with a 1 px --line between
// them. The row carries `data-setting` with its id, the id the palette and Settings' search open it by.

export function SettingsRow({
  id,
  label,
  description,
  wide = false,
  hidden = false,
  children,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** The control under the label, at the row's full width. */
  wide?: boolean;
  /** Left out by Settings' search: kept mounted, so a field keeps what was typed in it. */
  hidden?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="ui-setting-row" data-setting={id} data-wide={wide || undefined} hidden={hidden}>
      <div className="ui-setting-text">
        <div className="ui-setting-label">{label}</div>
        {description && <div className="ui-setting-desc">{description}</div>}
      </div>
      {children !== undefined && <div className="ui-setting-control">{children}</div>}
    </div>
  );
}
