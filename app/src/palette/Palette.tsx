import { useEffect, useMemo, useRef, useState } from "react";
import { statusFromStore, statusLines, type Command } from "@kinas/commands";
import { dispatchAppAction } from "../actions.ts";
import { filesIndexWarm, filesSearch, getUsageSnapshot, refreshReadings, type FileSearch } from "../api.ts";
import { refreshRoot, waitingCount } from "../reader/changes.ts";
import type { Shortcuts } from "../settings/shortcuts.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { SearchIcon } from "../ui/icons.tsx";
import { moreKey, PaletteFoot, PaletteGroupView } from "../ui/PaletteRow.tsx";
import { highlight } from "./match.ts";
import { snapshotAdapter } from "./snapshotAdapter.ts";
import { commandItems, fileItems, FILES_ASKED, GROUP_LABEL, toGroup, type PaletteGroup, type PaletteItem } from "./sources.ts";

// The ⌘K palette (R36, §3.7): the registry's palette door. Esc closes it and hands focus back to whatever had
// it — the terminal included — so the next keystroke reaches the shell without a click (R31).
//
// The interface polish (tasks/interface-polish, PRD rules 12–18): one search, in groups of Palette rows (ui/PaletteRow),
// each showing five then "N more". Commands answer as the query changes; Files asks search.rs 60 ms after the last
// keystroke, each question numbered so only the latest answer is drawn. The keys stay these four — typing, ↑ ↓,
// Enter, Esc (build-spec invariant 8); "N more" is a row the arrows reach, and Enter on it opens its group.

/** How long typing must pause before Files asks Rust. */
const FILES_DEBOUNCE_MS = 60;
/** While the index is still being built, how soon Files asks again. */
const INDEXING_RETRY_MS = 250;

/** `filesFolder`: the folder the sidebar's Files shows, for "Refresh files" (tree changes rule 16). `onFirstMate`: the
 * Crew page's First mate, for "Go to the first mate". `onOpen`: a file or folder found by name, opened as a sidebar
 * click opens it. `shortcuts`: the chords bound now, shown on their commands (rule 9). `folders`: the client folders,
 * whose chip a file under one carries. */
export function Palette({
  onClose,
  filesFolder,
  onFirstMate,
  onOpen,
  shortcuts,
  folders,
}: {
  onClose: () => void;
  filesFolder: string | null;
  onFirstMate: () => void;
  onOpen: (path: string) => void;
  shortcuts: Shortcuts;
  folders: readonly SeatedFolder[];
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Rust's latest answer, and the query it answered: the last one stays drawn while the next is asked. */
  const [answer, setAnswer] = useState<{ query: string; files: FileSearch | null } | null>(null);
  const files = answer?.files ?? null;
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);
  const searchSeq = useRef(0);

  useEffect(() => {
    input.current?.focus();
    void filesIndexWarm().catch(() => {});
    const previous = returnFocus.current;
    return () => {
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
        // A search that fails leaves Files out, as a group with no match is left out.
        () => {
          if (seq === searchSeq.current) setAnswer({ query, files: null });
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
  const acts = useRef({ run, onOpen, onClose });
  useEffect(() => {
    acts.current = { run, onOpen, onClose };
  });

  /** Each group with every row it matched (`all`), and as shown (`group`). */
  const built = useMemo(() => {
    const open = (path: string) => {
      acts.current.onOpen(path);
      acts.current.onClose();
    };
    const out: { all: PaletteItem[]; group: PaletteGroup }[] = [];
    const commands = commandItems(query, shortcuts, (c) => void acts.current.run(c));
    out.push({ all: commands, group: toGroup("command", commands, opened.has("command")) });
    if (files?.indexing) {
      out.push({ all: [], group: { id: "file", label: GROUP_LABEL.file, items: [], more: 0, state: "loading", note: "Indexing files…" } });
    } else if (files) {
      const found = fileItems(files, folders, open);
      out.push({ all: found, group: toGroup("file", found, opened.has("file"), files.more) });
    }
    return out.filter(({ group: g }) => g.items.length > 0 || g.state !== "ready");
  }, [query, shortcuts, files, folders, opened]);
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
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (keys.length === 0) return;
      const at = current === null ? 0 : keys.indexOf(current);
      setSelectedKey(keys[Math.max(0, Math.min(keys.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      enter();
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
            placeholder="Search files and commands"
            aria-label="Search"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <div className="palette-body">
          <ul className="palette-list" role="listbox" aria-label="Results">
            {groups.length === 0 && !blank && answer?.query === query && <li className="palette-empty">Nothing matches "{query.trim()}"</li>}
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
