import { useState } from "react";
import type { PinView } from "../api.ts";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, GaugeIcon, GearIcon, PinIcon, PinOffIcon, TerminalIcon } from "../icons.tsx";
import { FileTree } from "../reader/tree.tsx";
import { chordLabel, type Shortcuts } from "../settings/shortcuts.ts";
import type { RecentEntry } from "./recent.ts";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/**
 * The left sidebar (three-column shell §4): the pages, then what Miguel can open — Pinned, the open folder's Files,
 * and Recent — with Settings at the foot.
 *
 * A module-level component, like everything the shell mounts: a component defined inside App's render would be a
 * new type on every render, and React would remount the whole subtree each time.
 *
 * **A section with no rows is not rendered at all** (Miguel's choice): no header, no hint. A fresh launch shows the
 * pages and Settings, and nothing else.
 *
 * It owns no reader state. Clicks go up as paths; the shell turns them into `follow` requests for the reader, which
 * stays the single owner of what is open.
 */
export function Sidebar({
  hidden,
  page,
  shortcuts,
  onGo,
  pins,
  folder,
  folderPinned,
  selected,
  recent,
  onOpen,
  onPin,
  onUnpin,
}: {
  hidden: boolean;
  page: "usage" | "work" | "settings";
  shortcuts: Shortcuts;
  onGo: (page: "usage" | "work" | "settings") => void;
  pins: PinView[];
  /** The folder the reader has open (`kinas open <dir>`), or null. */
  folder: string | null;
  folderPinned: boolean;
  /** The open file, highlighted wherever it appears. */
  selected: string | null;
  recent: readonly RecentEntry[];
  onOpen: (path: string) => void;
  /** Absent until pins exist: then neither the folder's pin button nor anything else about pinning is drawn. */
  onPin?: (path: string) => void;
  onUnpin: (path: string) => void;
}) {
  return (
    <nav className="sidebar" aria-label="Sidebar" hidden={hidden}>
      <div className="sidebar-nav">
        <button type="button" className="sidebar-item" aria-current={page === "usage" ? "page" : undefined} onClick={() => onGo("usage")} title={`Usage (${chordLabel(shortcuts["go.usage"])})`}>
          <GaugeIcon size={16} />
          <span>Usage</span>
        </button>
        <button type="button" className="sidebar-item" aria-current={page === "work" ? "page" : undefined} onClick={() => onGo("work")} title={`Work (${chordLabel(shortcuts["go.work"])})`}>
          <TerminalIcon size={16} />
          <span>Work</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        {pins.length > 0 && (
          <section className="sidebar-section sidebar-pinned" aria-label="Pinned">
            <h2 className="sidebar-label">Pinned</h2>
            <ul className="sidebar-list">
              {pins.map((pin) => (
                <PinRow key={pin.path} pin={pin} selected={selected} onOpen={onOpen} onUnpin={onUnpin} />
              ))}
            </ul>
          </section>
        )}

        {folder && (
          // `reader-files` is the class the tree had inside the reader: the e2e finds the open file by it.
          <section className="sidebar-section reader-files" aria-label="Files">
            <div className="sidebar-section-head">
              <h2 className="sidebar-label" title={folder}>
                {baseName(folder)}
              </h2>
              {onPin && (
                <button
                  type="button"
                  className="sidebar-row-action"
                  aria-label={folderPinned ? "Unpin this folder" : "Pin this folder"}
                  title={folderPinned ? "Unpin this folder" : "Pin this folder"}
                  onClick={() => (folderPinned ? onUnpin(folder) : onPin(folder))}
                >
                  {folderPinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
                </button>
              )}
            </div>
            <FileTree root={folder} selected={selected} onOpen={onOpen} />
          </section>
        )}

        {recent.length > 0 && (
          <section className="sidebar-section sidebar-recent" aria-label="Recent">
            <h2 className="sidebar-label">Recent</h2>
            <ul className="sidebar-list">
              {recent.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className="sidebar-row" aria-current={entry.path === selected ? "true" : undefined} title={entry.displayPath} onClick={() => onOpen(entry.path)}>
                    <FileIcon size={14} />
                    <span className="sidebar-row-name">{baseName(entry.displayPath)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <button
        type="button"
        className="sidebar-item sidebar-settings"
        aria-label="Settings"
        aria-current={page === "settings" ? "page" : undefined}
        onClick={() => onGo("settings")}
        title={`Settings (${chordLabel(shortcuts.settings)})`}
      >
        <GearIcon size={16} />
        <span>Settings</span>
      </button>
    </nav>
  );
}

/**
 * One pin. A file opens; a folder is a disclosure whose tree is mounted **only while it is expanded** — otherwise
 * every pinned folder would list itself at launch, and one outside the projects folder would read as "Could not read
 * this folder" before Miguel had clicked anything (the click is what allows it).
 *
 * A pin whose file is gone stays, greyed: it does nothing when clicked, its Unpin still works, and Kinas never
 * removes it for him (§6.13).
 */
function PinRow({ pin, selected, onOpen, onUnpin }: { pin: PinView; selected: string | null; onOpen: (path: string) => void; onUnpin: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const missing = !pin.exists;
  const name = baseName(pin.display_path);
  const title = missing ? `${pin.display_path} is missing` : pin.display_path;
  const isDir = pin.kind === "dir";

  const activate = () => {
    if (missing) return;
    if (isDir) setExpanded((e) => !e);
    else onOpen(pin.path);
  };

  return (
    <li>
      <div className="sidebar-pin" data-missing={missing ? "" : undefined}>
        <button
          type="button"
          className="sidebar-row"
          aria-disabled={missing ? "true" : undefined}
          aria-expanded={isDir && !missing ? expanded : undefined}
          aria-current={!isDir && pin.path === selected ? "true" : undefined}
          title={title}
          onClick={activate}
        >
          {isDir ? expanded && !missing ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} /> : <FileIcon size={14} />}
          {isDir && <FolderIcon size={14} />}
          <span className="sidebar-row-name">{name}</span>
        </button>
        <button type="button" className="sidebar-row-action" aria-label="Unpin" title={`Unpin ${name}`} onClick={() => onUnpin(pin.path)}>
          <PinOffIcon size={14} />
        </button>
      </div>
      {isDir && expanded && !missing && <PinnedFolder path={pin.path} selected={selected} onOpen={onOpen} />}
    </li>
  );
}

/** A pinned folder's tree. Going through `onOpen` for the folder first is what allows a folder outside the root. */
function PinnedFolder({ path, selected, onOpen }: { path: string; selected: string | null; onOpen: (path: string) => void }) {
  return (
    <div className="sidebar-pin-tree">
      <FileTree root={path} selected={selected} onOpen={onOpen} />
    </div>
  );
}
