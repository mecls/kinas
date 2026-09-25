import { useEffect, useMemo, useRef, useState } from "react";
import { paletteMatches, statusFromStore, statusLines, type Command } from "@kinas/commands";
import { dispatchAppAction } from "../actions.ts";
import { getUsageSnapshot, refreshReadings } from "../api.ts";
import { refreshRoot, waitingCount } from "../reader/changes.ts";
import { snapshotAdapter } from "./snapshotAdapter.ts";

// The ⌘K palette (R36, §3.7): the registry's palette door. Esc closes it and hands focus back to whatever had
// it — the terminal included — so the next keystroke reaches the shell without a click (R31).

/** `filesFolder`: the folder the sidebar's Files shows, for "Refresh files" (tree changes rule 16). `onFirstMate`: the
 * Crew page's First mate, for "Go to the first mate". */
export function Palette({ onClose, filesFolder, onFirstMate }: { onClose: () => void; filesFolder: string | null; onFirstMate: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);

  const matches = useMemo(() => paletteMatches(query), [query]);

  useEffect(() => {
    input.current?.focus();
    const previous = returnFocus.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => setSelected(0), [query]);

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = matches[selected];
      if (command) void run(command);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={input}
          className="palette-input"
          value={query}
          placeholder="Type a command"
          aria-label="Command"
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <ul className="palette-list" role="listbox">
          {matches.length === 0 && <li className="palette-empty">No command matches "{query}"</li>}
          {matches.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === selected}
              className="palette-item"
              data-command={c.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void run(c)}
            >
              {c.title}
            </li>
          ))}
        </ul>
        {error && <p className="palette-error">{error}</p>}
        {output && <pre className="palette-output" data-testid="palette-output">{output.join("\n")}</pre>}
      </div>
    </div>
  );
}
