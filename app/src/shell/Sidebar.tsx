import { useEffect, useState } from "react";
import { type PinView, readerAllowClick } from "../api.ts";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, GaugeIcon, GearIcon, PinIcon, PinOffIcon, TerminalIcon } from "../icons.tsx";
import { FileTree, type FolderActions as TreeFolderActions } from "../reader/tree.tsx";
import { chordLabel, type Shortcuts } from "../settings/shortcuts.ts";
import { type Notice, NOTICE_MS } from "./notice.ts";
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
 *
 * **A folder is a thing in its own right here** (2026-09-21): wherever one shows — a row in a file tree, a row in
 * Recent, a pin, the Files header — pointing at it offers a terminal button and a pin button. The terminal button
 * asks Herdr for the folder's workspace (App's `onTerminal`); nothing is typed into the pane.
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
  onTerminal,
  notice,
  panelOpen,
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
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  /** Open this folder in the terminal: its Herdr workspace, focused or made. */
  onTerminal: (path: string) => void;
  /** What the shell last said. Shown here only while the panel is closed — open, the reader's status line has it. */
  notice: Notice | null;
  panelOpen: boolean;
}) {
  const isPinned = (path: string) => pins.some((p) => p.path === path);
  // Called, not mounted: a function made on every render is harmless as a function and would remount as a component.
  const folderActions: TreeFolderActions = (path, name) => (
    <FolderActions path={path} name={name} pinned={isPinned(path)} onTerminal={onTerminal} onPin={onPin} onUnpin={onUnpin} />
  );

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
                <PinRow key={pin.path} pin={pin} selected={selected} onOpen={onOpen} onUnpin={onUnpin} onTerminal={onTerminal} folderActions={folderActions} />
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
              <button type="button" className="sidebar-row-action" aria-label="Open this folder in the terminal" title="Open this folder in the terminal" onClick={() => onTerminal(folder)}>
                <TerminalIcon size={14} />
              </button>
              <button
                type="button"
                className="sidebar-row-action"
                aria-label={folderPinned ? "Unpin this folder" : "Pin this folder"}
                title={folderPinned ? "Unpin this folder" : "Pin this folder"}
                onClick={() => (folderPinned ? onUnpin(folder) : onPin(folder))}
              >
                {folderPinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
              </button>
            </div>
            <FileTree root={folder} selected={selected} onOpen={onOpen} folderActions={folderActions} />
          </section>
        )}

        {recent.length > 0 && (
          <section className="sidebar-section sidebar-recent" aria-label="Recent">
            <h2 className="sidebar-label">Recent</h2>
            <ul className="sidebar-list">
              {recent.map((entry) =>
                entry.kind === "dir" ? (
                  // A folder: its click reopens it in Files (the reader's `follow` takes a folder as it takes a file).
                  <li key={entry.path} data-kind="dir">
                    <div className="sidebar-entry">
                      <button type="button" className="sidebar-row" aria-current={entry.path === folder ? "true" : undefined} title={entry.displayPath} onClick={() => onOpen(entry.path)}>
                        <FolderIcon size={14} />
                        <span className="sidebar-row-name">{baseName(entry.displayPath)}</span>
                      </button>
                      {folderActions(entry.path, baseName(entry.displayPath))}
                    </div>
                  </li>
                ) : (
                  <li key={entry.path} data-kind="file">
                    <button type="button" className="sidebar-row" aria-current={entry.path === selected ? "true" : undefined} title={entry.displayPath} onClick={() => onOpen(entry.path)}>
                      <FileIcon size={14} />
                      <span className="sidebar-row-name">{baseName(entry.displayPath)}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        )}
      </div>

      <SidebarNotice notice={notice} panelOpen={panelOpen} />

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
 * this folder" before Miguel had clicked anything (the click is what allows it). A pinned folder's click stays that
 * disclosure (Miguel's choice): the terminal is a button beside Unpin, so a stray click makes nothing in Herdr.
 *
 * A pin whose file is gone stays, greyed: it does nothing when clicked, its Unpin still works, and Kinas never
 * removes it for him (§6.13).
 */
function PinRow({
  pin,
  selected,
  onOpen,
  onUnpin,
  onTerminal,
  folderActions,
}: {
  pin: PinView;
  selected: string | null;
  onOpen: (path: string) => void;
  onUnpin: (path: string) => void;
  onTerminal: (path: string) => void;
  folderActions: TreeFolderActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const missing = !pin.exists;
  const name = baseName(pin.display_path);
  const title = missing ? `${pin.display_path} is missing` : pin.display_path;
  const isDir = pin.kind === "dir";

  const activate = () => {
    if (missing) return;
    if (!isDir) return onOpen(pin.path);
    if (expanded) return setExpanded(false);
    // The click is what allows a folder outside the projects folder (reader R8), exactly as a click on a link
    // does — so it happens before the tree mounts and asks Rust to list it. A pin alone opens no door: after a
    // relaunch the session's allowed list is empty again, and this is what refills it. If Rust refuses, the tree
    // says so itself ("Could not read this folder").
    void readerAllowClick(pin.path)
      .catch(() => {})
      .then(() => setExpanded(true));
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
        {isDir && !missing && (
          <span className="sidebar-actions">
            <TerminalButton path={pin.path} name={name} onTerminal={onTerminal} />
          </span>
        )}
        <button type="button" className="sidebar-row-action" aria-label="Unpin" title={`Unpin ${name}`} onClick={() => onUnpin(pin.path)}>
          <PinOffIcon size={14} />
        </button>
      </div>
      {isDir && expanded && !missing && <PinnedFolder path={pin.path} selected={selected} onOpen={onOpen} folderActions={folderActions} />}
    </li>
  );
}

/** A pinned folder's tree, mounted only once the click that expanded it has been allowed (see `activate`). */
function PinnedFolder({ path, selected, onOpen, folderActions }: { path: string; selected: string | null; onOpen: (path: string) => void; folderActions: TreeFolderActions }) {
  return (
    <div className="sidebar-pin-tree">
      <FileTree root={path} selected={selected} onOpen={onOpen} folderActions={folderActions} />
    </div>
  );
}

function TerminalButton({ path, name, onTerminal }: { path: string; name: string; onTerminal: (path: string) => void }) {
  return (
    <button type="button" className="sidebar-row-action" aria-label={`Open ${name} in the terminal`} title={`Open ${name} in the terminal`} onClick={() => onTerminal(path)}>
      <TerminalIcon size={14} />
    </button>
  );
}

/**
 * What can be done to a folder from its row: open it in the terminal, pin it or unpin it. Out of the layout until the
 * row is pointed at or holds the focus (shell.css), so a folder's name keeps the row's width the rest of the time.
 */
function FolderActions({
  path,
  name,
  pinned,
  onTerminal,
  onPin,
  onUnpin,
}: {
  path: string;
  name: string;
  pinned: boolean;
  onTerminal: (path: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
}) {
  return (
    <span className="sidebar-actions">
      <TerminalButton path={path} name={name} onTerminal={onTerminal} />
      <button type="button" className="sidebar-row-action" aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`} title={pinned ? `Unpin ${name}` : `Pin ${name}`} onClick={() => (pinned ? onUnpin(path) : onPin(path))}>
        {pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
      </button>
    </span>
  );
}

/**
 * The shell's last notice, at the foot of the sidebar — **only while the panel is closed**. Open, the reader's status
 * line says it, and one place at a time is enough; closed, that line is hidden, and a refusal (a folder that has gone,
 * Herdr not running) would otherwise be a button that does nothing.
 *
 * Always mounted: it keeps its own clock from the moment the notice arrives, so a panel that closes four seconds into
 * a notice shows the two that are left, and one that opens and closes again does not replay it.
 */
function SidebarNotice({ notice, panelOpen }: { notice: Notice | null; panelOpen: boolean }) {
  const [shown, setShown] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const timer = window.setTimeout(() => setShown(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!shown || panelOpen) return null;
  return (
    <p className="sidebar-notice" role="status">
      {shown.text}
    </p>
  );
}
