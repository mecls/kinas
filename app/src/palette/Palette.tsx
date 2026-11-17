import { useEffect, useMemo, useRef, useState } from "react";
import { statusFromStore, statusLines, type Command } from "@kinas/commands";
import { dispatchAppAction } from "../actions.ts";
import {
  filesIndexWarm,
  filesSearch,
  getUsageSnapshot,
  herdrWorkspaces,
  recentList,
  refreshReadings,
  type CrewSnapshot,
  type FileSearch,
  type HerdrWorkspace,
  type RecentItem,
} from "../api.ts";
import { refreshRoot, waitingCount } from "../reader/changes.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { SearchIcon } from "../ui/icons.tsx";
import { moreKey, PaletteFoot, PaletteGroupView } from "../ui/PaletteRow.tsx";
import { paletteKey } from "./keys.ts";
import { highlight } from "./match.ts";
import { snapshotAdapter } from "./snapshotAdapter.ts";
import {
  commandItems,
  fileItems,
  FILES_ASKED,
  folderItems,
  GROUP_LABEL,
  inboxItems,
  NOTE,
  openItems,
  recentItems,
  settingItems,
  taskItems,
  toGroup,
  workspaceItems,
  type OpenItem,
  type PaletteGroup,
  type PaletteItem,
} from "./sources.ts";

// The ⌘K palette (R36, §3.7): the registry's palette door. Esc closes it and hands focus back to whatever had
// it — the terminal included — so the next keystroke reaches the shell without a click (R31).
//
// The interface polish (tasks/interface-polish, PRD rules 12–18): one search, in groups of Palette rows (ui/PaletteRow),
// each showing five then "N more", in rule 13's order. Before anything is typed: Recent, then Commands (rule 14). Once
// something is typed, every source: Commands and the in-window groups answer as the query changes; Files asks
// search.rs 60 ms after the last keystroke, each question numbered so only the latest answer is drawn; Workspaces are
// read from Herdr once, when the palette opens. A source still being read, or one that failed, says so in one line
// and the rest work (rule 18). The keys stay these four — typing, ↑ ↓, Enter, Esc (build-spec invariant 8, keys.ts);
// "N more" is a row the arrows reach, and Enter on it opens its group.

/** How long typing must pause before Files asks Rust. */
const FILES_DEBOUNCE_MS = 60;
/** While the index is still being built, how soon Files asks again. */
const INDEXING_RETRY_MS = 250;

/** `filesFolder`: the folder the sidebar's Files shows, for "Refresh files" (tree changes rule 16). `onFirstMate`: the
 * Crew page's First mate, for "Go to the first mate". `onOpen`: a file or folder found by name, opened as a sidebar
 * click opens it. `shortcuts`: the chords bound now, shown on their commands (rule 9). `folders`: the client folders,
 * whose chip a file under one carries. `tabs`: the reader's tabs. `crew`: App's one crew reading, for Tasks and Inbox.
 * `onTask`, `onItem`, `onSetting`, `onWorkspace`: rule 16's Enter for a task, an inbox item, a setting, a workspace. */
export function Palette({
  onClose,
  filesFolder,
  onFirstMate,
  onOpen,
  shortcuts,
  folders,
  tabs,
  crew,
  onTask,
  onItem,
  onSetting,
  onWorkspace,
}: {
  onClose: () => void;
  filesFolder: string | null;
  onFirstMate: () => void;
  onOpen: (path: string) => void;
  shortcuts: Shortcuts;
  folders: readonly SeatedFolder[];
  tabs: readonly { path: string; displayPath: string }[];
  crew: CrewSnapshot | null;
  onTask: (id: string) => void;
  onItem: OpenItem;
  onSetting: (id: string) => void;
  /** Focuses a Herdr workspace and shows the Work page. Resolves once Herdr has answered; rejects with its refusal. */
  onWorkspace: (id: string, label: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rust's latest answer, and the query it answered: the last one stays drawn while the next is asked. */
  const [answer, setAnswer] = useState<{ query: string; files: FileSearch | null; failed?: string } | null>(null);
  const files = answer?.files ?? null;
  /** Herdr's workspaces, read once when the palette opens: still being read, read, or why they could not be. */
  const [workspaces, setWorkspaces] = useState<{ state: "loading" } | { state: "ready"; list: HerdrWorkspace[] } | { state: "failed"; reason: string }>({
    state: "loading",
  });
  /** Recent, read once when the palette opens. */
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);
  const searchSeq = useRef(0);

  useEffect(() => {
    input.current?.focus();
    void filesIndexWarm().catch(() => {});
    let live = true;
    herdrWorkspaces().then(
      (list) => live && setWorkspaces({ state: "ready", list }),
      (e: unknown) => live && setWorkspaces({ state: "failed", reason: String(e) }),
    );
    recentList().then(
      (list) => live && setRecent(list),
      () => {},
    );
    const previous = returnFocus.current;
    return () => {
      live = false;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    setSelectedKey(null);
    setOpened(new Set());
  }, [query]);

  // Each question carries its number, and only the latest question's answer is drawn. Until the index is in, the
  // question is asked again, so "Indexing files…" gives way to the files without another keystroke.
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (query.trim() === "") {
      setAnswer(null);
      return;
    }
    let timer = 0;
    const ask = () => {
      filesSearch(query, FILES_ASKED).then(
        (found) => {
          if (seq !== searchSeq.current) return;
          setAnswer({ query, files: found });
          if (found.indexing) timer = window.setTimeout(ask, INDEXING_RETRY_MS);
        },
        // A search that fails says why in the Files group's one line (rule 18).
        (e: unknown) => {
          if (seq === searchSeq.current) setAnswer({ query, files: null, failed: String(e) });
        },
      );
    };
    timer = window.setTimeout(ask, FILES_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const run = async (command: Command) => {
    setError(null);
    setOutput(null);
    try {
      const out = await command.run({
        now: Date.now(),
        getStatus: async () => {
          const snapshot = await getUsageSnapshot();
          return statusFromStore(snapshotAdapter(snapshot), snapshot.now);
        },
        navigate: (page) => dispatchAppAction(`go.${page}`),
        firstMate: onFirstMate,
        refresh: () => refreshReadings(),
        refreshFiles: async () => {
          if (filesFolder === null) return null;
          const summary = await refreshRoot(filesFolder);
          return summary ? waitingCount(summary) : 0;
        },
        toggleSidebar: () => dispatchAppAction("sidebar"),
        openSettings: () => dispatchAppAction("settings"),
      });
      if (out.result) {
        setOutput(statusLines(out.result, false));
        return;
      }
      // A line to read — "No folder in Files to refresh" — keeps the palette open to show it.
      if (out.lines?.length) {
        setOutput(out.lines);
        return;
      }
      onClose();
    } catch (e) {
      setError(`${command.title} failed: ${String(e)}`);
    }
  };

  // The callbacks change with every render of App; the rows reach them through this, so the groups are rebuilt only
  // when what they show changes.
  const acts = useRef({ run, onOpen, onClose, onTask, onItem, onSetting, onWorkspace });
  useEffect(() => {
    acts.current = { run, onOpen, onClose, onTask, onItem, onSetting, onWorkspace };
  });

  /** Focuses a workspace: the palette closes once Herdr has answered, and stays open to say why when it refused. */
  const focusWorkspace = (id: string, label: string) => {
    setError(null);
    acts.current.onWorkspace(id, label).then(
      () => acts.current.onClose(),
      (e: unknown) => setError(String(e)),
    );
  };

  /** Each group with every row it matched (`all`), and as shown (`group`). */
  const built = useMemo(() => {
    const open = (path: string) => {
      acts.current.onOpen(path);
      acts.current.onClose();
    };
    // Each act closes the palette first, so the focus it hands back is where the target then takes it from.
    const then =
      <A extends unknown[]>(f: (...a: A) => void) =>
      (...a: A) => {
        acts.current.onClose();
        f(...a);
      };
    const out: { all: PaletteItem[]; group: PaletteGroup }[] = [];
    const add = (id: PaletteGroup["id"], all: PaletteItem[], beyond = 0) => out.push({ all, group: toGroup(id, all, opened.has(id), beyond) });
    /** A group that has no rows, only its one line: a source still being read, or one that failed. */
    const line = (id: PaletteGroup["id"], state: "loading" | "failed", note: string) =>
      out.push({ all: [], group: { id, label: GROUP_LABEL[id], items: [], more: 0, state, note } });
    const typed = query.trim() !== "";
    if (!typed) {
      const rows = recentItems(recent, Date.now(), folders, crew?.tasks ?? [], {
        open,
        task: then((id: string) => acts.current.onTask(id)),
        workspace: (label: string) => {
          const w = workspaces.state === "ready" ? workspaces.list.find((x) => x.label === label) : undefined;
          if (w) focusWorkspace(w.id, w.label);
          else setError(workspaces.state === "failed" ? NOTE.noHerdr : `No workspace is called ${label} now`);
        },
        setting: then((id: string) => acts.current.onSetting(id)),
      });
      out.push({ all: rows, group: { id: "recent", label: GROUP_LABEL.recent, items: rows, more: 0, state: "ready" } });
    }
    add(
      "command",
      commandItems(query, shortcuts, (c) => void acts.current.run(c)),
    );
    if (typed) add("open", openItems(query, tabs, folders, open));
    if (files?.indexing) line("file", "loading", NOTE.indexing);
    else if (files) {
      add("file", fileItems(files, folders, open), files.more);
      const last = out[out.length - 1]!;
      if (files.capped && last.group.id === "file") last.group.note = NOTE.capped;
    } else if (typed && answer?.query === query && answer.failed) line("file", "failed", NOTE.filesFailed(answer.failed));
    if (typed) {
      add("folder", folderItems(query, folders, open));
      add("task", taskItems(query, crew?.tasks ?? [], folders, then((id: string) => acts.current.onTask(id))));
      add("inbox", inboxItems(query, crew?.decisions ?? [], folders, crew?.now ?? Date.now(), then((task: string, key: string) => acts.current.onItem(task, key))));
      if (workspaces.state === "ready") add("workspace", workspaceItems(query, workspaces.list, folders, (w) => focusWorkspace(w.id, w.label)));
      else if (workspaces.state === "loading") line("workspace", "loading", NOTE.readingHerdr);
      else line("workspace", "failed", NOTE.noHerdr);
      add("setting", settingItems(query, then((id: string) => acts.current.onSetting(id))));
    }
    return out.filter(({ group: g }) => g.items.length > 0 || g.state !== "ready");
    // `focusWorkspace` reads only refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, shortcuts, files, answer, folders, opened, tabs, crew, workspaces, recent]);
  const groups = useMemo(() => built.map((b) => b.group), [built]);

  /** Every row the arrows reach, in order: each group's items, then its "N more". */
  const keys = useMemo(() => groups.flatMap((g) => [...g.items.map((i) => i.key), ...(g.more > 0 ? [moreKey(g.id)] : [])]), [groups]);
  const current = selectedKey !== null && keys.includes(selectedKey) ? selectedKey : (keys[0] ?? null);

  /** "N more" opens its group in place, and the first row it brings takes the selection where "N more" stood. */
  const openGroup = (id: string) => {
    const b = built.find((x) => x.group.id === id);
    setOpened((was) => new Set(was).add(id));
    const next = b?.all[b.group.items.length];
    if (next) setSelectedKey(next.key);
  };

  const pick = (item: PaletteItem) => item.act();

  const enter = () => {
    if (current === null) return;
    const group = groups.find((g) => moreKey(g.id) === current);
    if (group) {
      openGroup(group.id);
      return;
    }
    const item = groups.flatMap((g) => g.items).find((i) => i.key === current);
    if (item) pick(item);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = paletteKey(e.key);
    if (key === null) return;
    e.preventDefault();
    if (key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (key === "Enter") {
      enter();
    } else if (keys.length > 0) {
      const at = current === null ? 0 : keys.indexOf(current);
      setSelectedKey(keys[Math.max(0, Math.min(keys.length - 1, at + (key === "ArrowDown" ? 1 : -1)))]!);
    }
  };

  const blank = query.trim() === "";
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-head">
          <SearchIcon />
          <input
            ref={input}
            className="palette-input"
            value={query}
            placeholder="Search files, folders, tasks, workspaces, settings and commands"
            aria-label="Search"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <div className="palette-body">
          <ul className="palette-list" role="listbox" aria-label="Results">
            {groups.every((g) => g.items.length === 0) && !blank && answer?.query === query && <li className="palette-empty">Nothing matches "{query.trim()}"</li>}
            {groups.map((g) => (
              <PaletteGroupView
                key={g.id}
                group={g}
                selectedKey={current}
                runs={(item) => highlight(query, item.title)}
                onMore={() => openGroup(g.id)}
                onHover={setSelectedKey}
                onPick={pick}
              />
            ))}
          </ul>
          {error && <p className="palette-error">{error}</p>}
          {output && <pre className="palette-output" data-testid="palette-output">{output.join("\n")}</pre>}
        </div>
        <PaletteFoot />
      </div>
    </div>
  );
}
