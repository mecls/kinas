import { useCallback, useEffect, useRef, useState } from "react";
import { onAppAction, type AppAction } from "./actions.ts";
import { getUiPrefs, onOpenPalette, setShortcuts as saveShortcuts, setSidebarVisible } from "./api.ts";
import { SettingsPage } from "./pages/Settings.tsx";
import { UsagePage } from "./pages/Usage.tsx";
import { WorkPage } from "./pages/Work.tsx";
import { Palette } from "./palette/Palette.tsx";
import { actionForEvent, chordLabel, DEFAULT_SHORTCUTS, withDefaults, type Shortcuts } from "./settings/shortcuts.ts";

export type Page = "usage" | "work" | "settings";

// Shortcuts come from Settings (keymap.md; by default ⌘1 / ⌘2 switch pages, ⌘S hides or shows the sidebar, ⌘K opens
// the palette, ⌘, opens Settings). Every page stays mounted and only its visibility changes, so the terminal on the
// Work page is never unmounted and its PTY never restarts (R33).
export function App() {
  const [page, setPage] = useState<Page>("usage");
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const shortcutsRef = useRef(shortcuts);
  const sidebarShown = useRef(true);
  /** Where Esc on Settings goes back to. */
  const lastPage = useRef<Exclude<Page, "settings">>("usage");
  const pageRef = useRef(page);

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

  const run = useCallback(
    (action: AppAction) => {
      if (action === "go.usage") setPage("usage");
      else if (action === "go.work") setPage("work");
      else if (action === "palette") setPalette(true);
      else if (action === "settings") {
        setPalette(false);
        setPage("settings");
      } else if (action === "sidebar") {
        showSidebar(!sidebarShown.current);
        void setSidebarVisible(sidebarShown.current).catch(() => {});
      }
    },
    [showSidebar],
  );

  // The saved shortcuts and sidebar; the defaults apply until they arrive.
  useEffect(() => {
    getUiPrefs().then(
      (prefs) => {
        setShortcuts(withDefaults(prefs.shortcuts));
        showSidebar(prefs.sidebar_visible);
      },
      () => {},
    );
  }, [showSidebar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The terminal decides its own ⌘ chords (keyContract.ts) and raises them as app actions, so acting here too
      // would run a toggle twice. A chord being recorded in Settings runs nothing.
      if (e.target instanceof Element && e.target.closest(".terminal, [data-recording]")) return;
      // Esc on Settings goes back wherever focus is (WebKit drops it when a button is clicked); the palette keeps
      // its own Esc.
      if (e.key === "Escape" && pageRef.current === "settings" && !(e.target instanceof Element && e.target.closest(".overlay"))) {
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

  const changeShortcuts = useCallback(async (next: Shortcuts) => {
    await saveShortcuts(next);
    setShortcuts(next);
  }, []);

  return (
    <div className="shell" data-sidebar={sidebar ? "shown" : "hidden"}>
      <nav className="rail" aria-label="Pages" hidden={!sidebar}>
        <button
          type="button"
          className="rail-item"
          aria-current={page === "usage" ? "page" : undefined}
          onClick={() => setPage("usage")}
          title={`Usage (${chordLabel(shortcuts["go.usage"])})`}
        >
          Usage
        </button>
        <button
          type="button"
          className="rail-item"
          aria-current={page === "work" ? "page" : undefined}
          onClick={() => setPage("work")}
          title={`Work (${chordLabel(shortcuts["go.work"])})`}
        >
          Work
        </button>
        <button
          type="button"
          className="rail-item rail-settings"
          aria-label="Settings"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => setPage("settings")}
          title={`Settings (${chordLabel(shortcuts.settings)})`}
        >
          <GearIcon />
        </button>
      </nav>
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
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

/** Lucide's "settings" gear (ISC licence), in the rail's thin-line weight. */
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
