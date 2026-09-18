import { useCallback, useEffect, useRef, useState } from "react";
import { onAppAction, type AppAction } from "./actions.ts";
import {
  getUiPrefs,
  onOpenPalette,
  onReaderShow,
  type PinView,
  readerErrorOf,
  readerPin,
  readerPins,
  readerUnpin,
  setReaderWidth as saveReaderWidth,
  setShortcuts as saveShortcuts,
  setSidebarVisible,
} from "./api.ts";
import { SettingsPage } from "./pages/Settings.tsx";
import { UsagePage } from "./pages/Usage.tsx";
import { WorkPage } from "./pages/Work.tsx";
import { Palette } from "./palette/Palette.tsx";
import { Reader, type ReaderNav, type ReaderRequest } from "./reader/Reader.tsx";
import { actionForEvent, DEFAULT_SHORTCUTS, withDefaults, type Shortcuts } from "./settings/shortcuts.ts";
import { focusTerminal, terminalHasFocus } from "./shell/focus.ts";
import { pushRecent, type RecentEntry } from "./shell/recent.ts";
import { Sidebar } from "./shell/Sidebar.tsx";
import { DEFAULT_PANEL_PCT } from "./shell/split.ts";
import { useSplit } from "./shell/useSplit.ts";

export type Page = "usage" | "work" | "settings";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** The panel on the right of the window. Its one occupant is the reader; it stays mounted while closed. */
interface PanelState {
  open: boolean;
  /** The panel has the whole stage; the page and the divider are out of the layout (shell.css). Session state only. */
  expanded: boolean;
  request: ReaderRequest | null;
}

// Shortcuts come from Settings (keymap.md; by default ⌘1 / ⌘2 switch pages, ⌘S hides or shows the sidebar, ⌘K opens
// the palette, ⌘, opens Settings). Every page stays mounted and only its visibility changes, so the terminal on the
// Work page is never unmounted and its PTY never restarts (R33).
//
// The tree below is static (tasks/three-column-shell-build-spec.md §6.1): the sidebar, the stage, the page, the
// divider and the panel are always there, and only `hidden` and the data attributes change. Anything that wrapped, re-keyed
// or conditionally rendered an ancestor of <Terminal> would remount it and restart the PTY.
export function App() {
  const [page, setPage] = useState<Page>("usage");
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [reader, setReader] = useState<PanelState>({ open: false, expanded: false, request: null });
  const readerSeq = useRef(0);
  const [readerWidth, setReaderWidth] = useState(DEFAULT_PANEL_PCT);
  /** What the reader has open, mirrored for the sidebar. The reader owns it; this is only what it last reported. */
  const [nav, setNav] = useState<ReaderNav>({ doc: null, folder: null });
  /** Stored, by an explicit click, and nothing else about what Miguel reads is (reader/pins.rs). */
  const [pins, setPins] = useState<PinView[]>([]);
  /** In memory only, by design: what was merely opened is forgotten when Kinas quits (shell/recent.ts). */
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);
  /** Something the shell wants said where the reader says things: its status line. */
  const [notice, setNotice] = useState<{ text: string; seq: number } | null>(null);
  const noticeSeq = useRef(0);
  const shortcutsRef = useRef(shortcuts);
  const sidebarShown = useRef(true);
  /** Where Esc on Settings goes back to. */
  const lastPage = useRef<Exclude<Page, "settings">>("usage");
  const pageRef = useRef(page);
  const expandedRef = useRef(false);
  /** Whether the keys were the terminal's when the panel expanded over it, so collapsing can give them back. */
  const terminalHadFocus = useRef(false);
  /** Set when the terminal should get the keys once the layout that hides it has gone. */
  const wantTerminalFocus = useRef(false);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    pageRef.current = page;
    if (page !== "settings") lastPage.current = page;
  }, [page]);

  const showSidebar = useCallback((shown: boolean) => {
    sidebarShown.current = shown;
    setSidebar(shown);
  }, []);

  // Expanded, the panel has the whole stage and the page is out of the layout — not covered, gone, so the terminal's
  // ResizeObserver sees no box and the PTY keeps its size (three-column shell §6.2). The hidden terminal drops its
  // focus, so whether it had the keys is remembered here and they are given back on the way out.
  const setExpanded = useCallback((next: boolean) => {
    if (expandedRef.current === next) return;
    if (next) terminalHadFocus.current = terminalHasFocus();
    else if (terminalHadFocus.current) wantTerminalFocus.current = true;
    expandedRef.current = next;
    setReader((r) => ({ ...r, expanded: next }));
  }, []);

  // Going to a page means wanting to see it: an expanded panel goes back to the side.
  const goTo = useCallback(
    (next: Page) => {
      setExpanded(false);
      setPage(next);
    },
    [setExpanded],
  );

  const run = useCallback(
    (action: AppAction) => {
      if (action === "go.usage") goTo("usage");
      else if (action === "go.work") goTo("work");
      else if (action === "palette") setPalette(true);
      else if (action === "settings") {
        setPalette(false);
        goTo("settings");
      } else if (action === "sidebar") {
        showSidebar(!sidebarShown.current);
        void setSidebarVisible(sidebarShown.current).catch(() => {});
      }
    },
    [goTo, showSidebar],
  );

  // The saved shortcuts and sidebar; the defaults apply until they arrive.
  useEffect(() => {
    getUiPrefs().then(
      (prefs) => {
        setShortcuts(withDefaults(prefs.shortcuts));
        showSidebar(prefs.sidebar_visible);
        setReaderWidth(prefs.reader_width_pct);
      },
      () => {},
    );
  }, [showSidebar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The terminal decides its own ⌘ chords (keyContract.ts) and raises them as app actions, so acting here too
      // would run a toggle twice. A chord being recorded in Settings runs nothing.
      if (e.target instanceof Element && e.target.closest(".terminal, [data-recording]")) return;
      // Esc on Settings goes back wherever focus is (WebKit drops it when a button is clicked); the palette and the
      // reader's menu keep their own Esc, and an expanded reader has taken Settings' place, so Esc is not about it.
      if (e.key === "Escape" && pageRef.current === "settings" && !expandedRef.current && !(e.target instanceof Element && e.target.closest(".overlay, [role=menu]"))) {
        e.preventDefault();
        setPage(lastPage.current);
        return;
      }
      const action = actionForEvent(e, shortcutsRef.current);
      if (!action) return;
      e.preventDefault();
      if (!e.repeat) run(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run]);

  // Actions raised from inside the terminal (which swallows ⌘ chords before they bubble, R31), the palette or a page.
  useEffect(() => onAppAction(run), [run]);

  // The global hotkey (R30) brings the window forward in Rust, then asks for the palette.
  useEffect(() => {
    const stop = onOpenPalette(() => setPalette(true));
    return () => void stop.then((u) => u());
  }, []);

  // An accepted `kinas open`: Rust has brought the window forward; show the reader in the panel, beside whichever
  // page is showing (reader R18, amended 2026-09-18 — it no longer switches to the Work page).
  // Keyboard focus stays where it was (R34): an agent opens its plan while Miguel is typing to it in the pane.
  useEffect(() => {
    const stop = onReaderShow((event) => {
      const had = document.activeElement;
      const inTerminal = had instanceof HTMLElement && terminalHasFocus();
      setReader((r) => ({ open: true, expanded: r.open && r.expanded, request: { type: "show", ...event, seq: ++readerSeq.current } }));
      if (inTerminal) {
        // Bringing the window forward can move focus when the app activates, after this frame; put it back then too.
        const restore = () => {
          if (had.isConnected && document.activeElement !== had) had.focus({ preventScroll: true });
        };
        requestAnimationFrame(restore);
        window.addEventListener("focus", restore, { once: true });
        window.setTimeout(() => window.removeEventListener("focus", restore), 1000);
      }
    });
    return () => void stop.then((u) => u());
  }, []);

  // Closing the reader with × gives the terminal the keys (keymap.md) — while the Work page is showing. Anywhere
  // else the terminal is hidden and cannot take focus, so focus is left where it was.
  const closeReader = useCallback(() => {
    expandedRef.current = false;
    terminalHadFocus.current = false;
    setReader((r) => {
      // Only a close that closes something: a flag left set by a no-op would hand the terminal the keys the next
      // time the page changed, long after anyone asked. (Idempotent, so safe inside an updater.)
      if (r.open) wantTerminalFocus.current = true;
      return { ...r, open: false, expanded: false };
    });
  }, []);

  // After the commit, not in the handler: closing or collapsing an expanded panel is what puts the terminal back in
  // the layout, and an element with no box cannot take focus.
  useEffect(() => {
    if (!wantTerminalFocus.current || reader.expanded) return;
    wantTerminalFocus.current = false;
    if (page === "work") focusTerminal();
  }, [reader.open, reader.expanded, page]);

  // The divider between the page and the panel; remembered across launches like the sidebar. The stored key keeps
  // its name from when the reader split the Work page: it is still the reader's share of the row it sits in.
  const changeReaderWidth = useCallback((pct: number) => {
    setReaderWidth(pct);
    void saveReaderWidth(pct).catch(() => {});
  }, []);

  const split = useSplit(readerWidth, changeReaderWidth);

  // Stable, because the reader's reporting effect is keyed on it. Every file that opens goes to the front of Recent.
  const onNav = useCallback((next: ReaderNav) => {
    setNav(next);
    const opened = next.doc;
    if (opened) setRecent((list) => pushRecent(list, opened));
  }, []);

  // The pins, at launch — and again whenever the window comes forward, because a pinned file can vanish or come
  // back while Kinas sits in the background, and a row that lies about that is worse than no row.
  useEffect(() => {
    const load = () => void readerPins().then(setPins, () => {});
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  const say = useCallback((text: string) => setNotice({ text, seq: ++noticeSeq.current }), []);

  // Rust decides whether a path may be pinned, and says why not in its own words.
  const pin = useCallback(
    (path: string) => {
      readerPin(path).then(
        (next) => {
          setPins(next);
          say(`Pinned ${baseName(path)}`);
        },
        (e) => say(readerErrorOf(e).message),
      );
    },
    [say],
  );

  const unpin = useCallback(
    (path: string) => {
      readerUnpin(path).then(
        (next) => {
          setPins(next);
          say(`Unpinned ${baseName(path)}`);
        },
        (e) => say(readerErrorOf(e).message),
      );
    },
    [say],
  );

  const isPinned = (path: string | null | undefined) => path != null && pins.some((p) => p.path === path);

  // A click on a file in the sidebar. It goes to the reader as a `follow` — the path a click on the reader's own
  // tree takes — and never as a made-up `kinas open`, which would clear the open folder, skip the human-click door
  // and add a line to the log the 200 ms gate counts (three-column shell §6.14). It opens the panel if it is closed.
  const openFromSidebar = useCallback((path: string) => {
    setReader((r) => ({ open: true, expanded: r.open && r.expanded, request: { type: "follow", path, seq: ++readerSeq.current } }));
  }, []);

  const changeShortcuts = useCallback(async (next: Shortcuts) => {
    await saveShortcuts(next);
    setShortcuts(next);
  }, []);

  return (
    <div className="shell" data-sidebar={sidebar ? "shown" : "hidden"} data-panel={!reader.open ? "closed" : reader.expanded ? "expanded" : "open"}>
      <Sidebar
        hidden={!sidebar}
        page={page}
        shortcuts={shortcuts}
        onGo={goTo}
        pins={pins}
        folder={nav.folder}
        folderPinned={isPinned(nav.folder)}
        selected={nav.doc?.path ?? null}
        recent={recent}
        onOpen={openFromSidebar}
        onPin={pin}
        onUnpin={unpin}
      />
      <div className="stage" ref={split.row} data-dragging={split.isDragging ? "" : undefined}>
        <main className="content">
          <section className="page" data-page="usage" hidden={page !== "usage"}>
            <UsagePage active={page === "usage"} />
          </section>
          <section className="page" data-page="work" hidden={page !== "work"}>
            <WorkPage active={page === "work"} shortcuts={shortcuts} />
          </section>
          <section className="page" data-page="settings" hidden={page !== "settings"}>
            <SettingsPage active={page === "settings"} shortcuts={shortcuts} onShortcutsChange={changeShortcuts} />
          </section>
        </main>
        <div className="stage-divider" hidden={!reader.open} {...split.divider} />
        {/* `reader` is kept beside `shell-panel`: reader.css styles it, and the e2e finds the panel as `aside.reader`. */}
        {/* Expanded, the width is shell.css's: an inline flex-basis would out-rank it. */}
        <aside className="shell-panel reader" aria-label="Reader" hidden={!reader.open} style={reader.expanded ? undefined : { flexBasis: `${split.pct}%` }}>
          <Reader
            request={reader.request}
            onClose={closeReader}
            expanded={reader.expanded}
            onExpand={setExpanded}
            onNav={onNav}
            treeInSidebar={sidebar}
            pinned={isPinned(nav.doc?.path)}
            onPin={pin}
            onUnpin={unpin}
            notice={notice}
          />
        </aside>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}
