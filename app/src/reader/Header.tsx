import { useEffect, useState } from "react";
import { BackIcon, ChangesIcon, ChevronDownIcon, CloseIcon, CodeIcon, CollapseIcon, ExpandIcon, EyeIcon, FolderIcon, ListIcon } from "../ui/icons.tsx";
import { extBadge, splitDisplayPath } from "./labels.ts";
import { Menu, type MenuItem } from "../ui/Menu.tsx";

/** Changes (tree changes rule 19) exists only while the open file has a mark: the reader says which views it offers. */
export type View = "rendered" | "source" | "changes";

/**
 * Files or Contents: wide, it hides and shows its section beside the text; narrow, it opens it over the text
 * (reader/side.ts computes both, with the tooltip).
 */
interface SectionToggle {
  pressed: boolean;
  title: string;
  onToggle: () => void;
}

/**
 * The reader's header (three-column shell §4): Back, the view toggle, the path and its badge, then Files and
 * Contents whenever they are offered, Copy with its ▾ menu, Expand and Close.
 *
 * Presentation only — the reader owns every piece of state except whether the menu is open.
 */
export function Header({
  displayPath,
  title,
  showBadge,
  canGoBack,
  onBack,
  views,
  view,
  onView,
  changesSince,
  files,
  contents,
  copyDisabledReason,
  onCopy,
  menu,
  menuResetKey,
  expanded,
  onExpand,
  onClose,
}: {
  /** What `.reader-path` says. The e2e tells two files of one name apart by it, so it is the whole display path. */
  displayPath: string;
  title: string;
  /** Only a file has a kind worth a badge; a folder's name may contain a dot without meaning anything by it. */
  showBadge: boolean;
  canGoBack: boolean;
  onBack: () => void;
  /** What the toggle offers, in order; null for a file with one way to be shown — unmarked source, and images. */
  views: readonly View[] | null;
  view: View | null;
  onView: (view: View) => void;
  /** The open file's baseline, "14:02", for Changes' tooltip. */
  changesSince: string | null;
  files: SectionToggle | null;
  contents: SectionToggle | null;
  copyDisabledReason: string | null;
  onCopy: () => void;
  menu: MenuItem[];
  /** Changes whenever what is showing changes, or the reader closes: an open menu is about the old document. */
  menuResetKey: string;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [menuResetKey]);

  const { dir, name } = splitDisplayPath(displayPath);
  const badge = showBadge ? extBadge(name) : null;

  return (
    <header className="reader-head">
      <button type="button" className="reader-button reader-icon-button" onClick={onBack} disabled={!canGoBack} aria-label="Back" title="Back">
        <BackIcon />
      </button>
      {views && views.length > 0 && (
        <div className="reader-view" role="group" aria-label="View">
          {views.includes("rendered") && (
            <button type="button" className="reader-view-button" aria-label="Rendered" aria-pressed={view === "rendered"} title="Show it rendered" onClick={() => onView("rendered")}>
              <EyeIcon />
            </button>
          )}
          {views.includes("source") && (
            <button type="button" className="reader-view-button" aria-label="Source" aria-pressed={view === "source"} title="Show the file's text" onClick={() => onView("source")}>
              <CodeIcon />
            </button>
          )}
          {views.includes("changes") && (
            <button
              type="button"
              className="reader-view-button"
              aria-label="Changes"
              aria-pressed={view === "changes"}
              title={changesSince ? `Show what changed since ${changesSince}` : "Show what changed"}
              onClick={() => onView("changes")}
            >
              <ChangesIcon />
            </button>
          )}
        </div>
      )}
      <span className="reader-path" title={title}>
        {dir && <span className="reader-path-dir">{dir}</span>}
        <span className="reader-path-name">{name}</span>
      </span>
      {badge && <span className="reader-ext">{badge}</span>}
      {files && (
        <button type="button" className="reader-button reader-icon-button" aria-label="Files" title={files.title} aria-pressed={files.pressed} onClick={files.onToggle}>
          <FolderIcon />
        </button>
      )}
      {contents && (
        <button type="button" className="reader-button reader-icon-button" aria-label="Contents" title={contents.title} aria-pressed={contents.pressed} onClick={contents.onToggle}>
          <ListIcon />
        </button>
      )}
      <div className="reader-copy">
        <button type="button" className="reader-copy-main" aria-disabled={copyDisabledReason ? "true" : undefined} title={copyDisabledReason ?? "Copy the file's text"} onClick={() => !copyDisabledReason && onCopy()}>
          Copy
        </button>
        <button type="button" className="reader-copy-more" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} title="More actions" onClick={() => setMenuOpen((open) => !open)}>
          <ChevronDownIcon size="sm" />
        </button>
        {menuOpen && <Menu className="reader-menu" label="More actions" items={menu} onClose={() => setMenuOpen(false)} />}
      </div>
      <button
        type="button"
        className="reader-button reader-icon-button"
        aria-label={expanded ? "Collapse" : "Expand"}
        title={expanded ? "Back to the side" : "Use the whole width"}
        onClick={() => onExpand(!expanded)}
      >
        {expanded ? <CollapseIcon /> : <ExpandIcon />}
      </button>
      <button type="button" className="reader-button reader-icon-button reader-close" onClick={onClose} aria-label="Close the reader" title="Hide the reader; the tabs stay">
        <CloseIcon />
      </button>
    </header>
  );
}
