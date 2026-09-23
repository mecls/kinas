import { seatFolders } from "./folders.ts";
import { useEffect, useState } from "react";
import { getUsageSnapshot, onReadingsChanged, type PinView, type ProjectRow, readerAllowClick } from "../api.ts";
import type { Page } from "../App.tsx";
import { FileTree, type FolderActions as TreeFolderActions } from "../reader/tree.tsx";
import { chordLabel, type Shortcuts } from "../settings/shortcuts.ts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ConnectionRow,
  CrewIcon,
  FileIcon,
  FolderIcon,
  GaugeIcon,
  GearIcon,
  HomeIcon,
  InboxIcon,
  NavHeading,
  NavItem,
  PinIcon,
  PinOffIcon,
  TerminalIcon,
  Toast,
  Wordmark,
} from "../ui/index.ts";
import { type Connection, connectionOf } from "./connection.ts";
import { type Notice, NOTICE_MS } from "./notice.ts";
import type { RecentEntry } from "./recent.ts";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** The sidebar asks for the VPS reading this often when nothing else changes; a new reading arrives as an event. */
const CONNECTION_MS = 60_000;

/**
 * The left sidebar (DESIGN.md §3.1; three-column shell §4): the wordmark, the seven navigation rows, then what Miguel
 * can open — Pinned, the open folder's Files, Recent — then the client folders with their chips, the shell's last
 * notice, and the VPS row at the foot.
 *
 * A module-level component, like everything the shell mounts: a component defined inside App's render would be a
 * new type on every render, and React would remount the whole subtree each time.
 *
 * **A section with no rows is not rendered at all** (Miguel's choice): no header, no hint. A fresh launch shows the
 * pages and, once the projects root has been walked, the client folders.
 *
 * It owns no reader state. Clicks go up as paths; the shell turns them into `follow` requests for the reader, which
 * stays the single owner of what is open. The Reader row is a button, not a page (keymap.md, 2026-09-22): it asks
 * the shell to bring the panel back, and reads as current while the panel is open.
 *
 * **A folder is a thing in its own right here** (2026-09-21): wherever one shows — a row in a file tree, a row in
 * Recent, a pin, the Files header, a client folder — pointing at it offers a terminal button and a pin button. The
 * terminal button asks Herdr for the folder's workspace (App's `onTerminal`); nothing is typed into the pane.
 */
export function Sidebar({
  hidden,
  page,
  shortcuts,
  onGo,
  onReader,
  readerOpen,
  projects,
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
  page: Page;
  shortcuts: Shortcuts;
  onGo: (page: Page) => void;
  /** The Reader row: bring the panel back with what it last showed. */
  onReader: () => void;
  readerOpen: boolean;
  /** The git repositories under the projects root (projects.rs), in the order found. */
  projects: readonly ProjectRow[];
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
  const chord = (action: keyof Shortcuts) => chordLabel(shortcuts[action]);
  const current = (p: Page) => page === p;

  return (
    <nav className="sidebar" aria-label="Sidebar" hidden={hidden}>
      <Wordmark />
      <div className="sidebar-nav">
        <NavItem icon={<HomeIcon />} label="Home" current={current("home")} onClick={() => onGo("home")} title={`Home (${chord("go.home")})`} />
        <NavItem icon={<TerminalIcon />} label="Work" current={current("work")} onClick={() => onGo("work")} title={`Work (${chord("go.work")})`} />
        <NavItem icon={<CrewIcon />} label="Crew" current={current("crew")} onClick={() => onGo("crew")} />
        <NavItem icon={<InboxIcon />} label="Inbox" current={current("inbox")} count={0} onClick={() => onGo("inbox")} />
        <NavItem icon={<GaugeIcon />} label="Usage" current={current("usage")} onClick={() => onGo("usage")} title={`Usage (${chord("go.usage")})`} />
        <NavItem icon={<FileIcon />} label="Reader" current={readerOpen} onClick={onReader} aria-label="Reader" title="Reader: the last document, back in the panel" />
        <NavItem icon={<GearIcon />} label="Settings" current={current("settings")} onClick={() => onGo("settings")} aria-label="Settings" title={`Settings (${chord("settings")})`} />
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
                <TerminalIcon size="sm" />
              </button>
              <button
                type="button"
                className="sidebar-row-action"
                aria-label={folderPinned ? "Unpin this folder" : "Pin this folder"}
                title={folderPinned ? "Unpin this folder" : "Pin this folder"}
                onClick={() => (folderPinned ? onUnpin(folder) : onPin(folder))}
              >
                {folderPinned ? <PinOffIcon size="sm" /> : <PinIcon size="sm" />}
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
                        <FolderIcon size="sm" />
                        <span className="sidebar-row-name">{baseName(entry.displayPath)}</span>
                      </button>
                      {folderActions(entry.path, baseName(entry.displayPath))}
                    </div>
                  </li>
                ) : (
                  <li key={entry.path} data-kind="file">
                    <button type="button" className="sidebar-row" aria-current={entry.path === selected ? "true" : undefined} title={entry.displayPath} onClick={() => onOpen(entry.path)}>
                      <FileIcon size="sm" />
                      <span className="sidebar-row-name">{baseName(entry.displayPath)}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        )}

        {projects.length > 0 && <ClientFolders projects={projects} folder={folder} onOpen={onOpen} folderActions={folderActions} />}
      </div>

      <SidebarNotice notice={notice} panelOpen={panelOpen} />
      <Machine />
    </nav>
  );
}

/**
 * The client folders (DESIGN.md §3.1): one row per repository, its chip in the category Settings chose or the name
 * derives, the internal ones last and tagged. A click opens the folder in the reader — Files and its README — as a
 * folder in Recent does; the terminal and pin buttons appear beside it as they do on every folder row.
 */
function ClientFolders({ projects, folder, onOpen, folderActions }: { projects: readonly ProjectRow[]; folder: string | null; onOpen: (path: string) => void; folderActions: TreeFolderActions }) {
  const ordered = seatFolders(projects);
  return (
    <section className="sidebar-section sidebar-folders" aria-label="Client folders">
      <NavHeading>Client folders</NavHeading>
      <ul className="sidebar-list">
        {ordered.map((p) => (
          <li key={p.path} data-kind="dir" data-cat={p.cat} data-internal={p.internal ? "" : undefined}>
            <div className="sidebar-entry">
              <NavItem chip={p.cat} label={p.name} tag={p.internal ? "internal" : undefined} current={p.path === folder} title={p.display} onClick={() => onOpen(p.path)} />
              {folderActions(p.path, p.name)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The VPS row at the foot, from the same reading the Usage page shows (shell/connection.ts); nothing when no machine is watched. */
function Machine() {
  const [connection, setConnection] = useState<Connection | null>(null);
  useEffect(() => {
    const load = () => void getUsageSnapshot().then((s) => setConnection(connectionOf(s)), () => {});
    load();
    const timer = window.setInterval(load, CONNECTION_MS);
    const stop = onReadingsChanged(load);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      void stop.then((u) => u());
    };
  }, []);
  if (!connection) return null;
  return <ConnectionRow name={connection.name} state={connection.state} detail={connection.detail} />;
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
          {isDir ? expanded && !missing ? <ChevronDownIcon size="sm" /> : <ChevronRightIcon size="sm" /> : <FileIcon size="sm" />}
          {isDir && <FolderIcon size="sm" />}
          <span className="sidebar-row-name">{name}</span>
        </button>
        {isDir && !missing && (
          <span className="sidebar-actions">
            <TerminalButton path={pin.path} name={name} onTerminal={onTerminal} />
          </span>
        )}
        <button type="button" className="sidebar-row-action" aria-label="Unpin" title={`Unpin ${name}`} onClick={() => onUnpin(pin.path)}>
          <PinOffIcon size="sm" />
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
      <TerminalIcon size="sm" />
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
        {pinned ? <PinOffIcon size="sm" /> : <PinIcon size="sm" />}
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
    <Toast className="sidebar-notice">{shown.text}</Toast>
  );
}
