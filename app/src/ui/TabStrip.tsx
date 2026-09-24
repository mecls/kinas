import { CloseIcon, FileIcon } from "./icons.tsx";
import "./TabStrip.css";

// DESIGN.md §4 Tab strip (1.5, the reader's layout): one row of tabs above the reader's header, one per file opened
// this session. Presentation only — the reader owns the tabs (reader/tabs.ts). Click-only (keymap.md): a tab takes no
// focus, and a press on the strip is kept from moving it, so the terminal keeps the keys while tabs are switched.

export interface TabStripTab {
  /** The tab's identity, carried on the tab as `data-path`: the reader keys tabs on the file's real path. */
  key: string;
  name: string;
  /** The parent folder's name, when another tab has the same name; null otherwise. */
  detail: string | null;
  /** The tooltip: the display path, as the reader's header says it. */
  title: string;
}

export function TabStrip({
  label,
  tabs,
  selected,
  onSelect,
  onClose,
}: {
  /** The tablist's accessible name. */
  label: string;
  tabs: readonly TabStripTab[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  return (
    <div className="ui-tabstrip" role="tablist" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className="ui-tab"
          role="tab"
          aria-selected={tab.key === selected}
          data-path={tab.key}
          title={tab.title}
          onClick={() => tab.key !== selected && onSelect(tab.key)}
        >
          <FileIcon size="sm" />
          <span className="ui-tab-name">
            {tab.name}
            {tab.detail && <span className="ui-tab-detail"> · {tab.detail}</span>}
          </span>
          <button
            type="button"
            className="ui-tab-close"
            aria-label={`Close ${tab.name}`}
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.key);
            }}
          >
            <CloseIcon size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
