import { useEffect, useState } from "react";
import { onAppAction } from "./actions.ts";
import { onOpenPalette } from "./api.ts";
import { UsagePage } from "./pages/Usage.tsx";
import { WorkPage } from "./pages/Work.tsx";
import { Palette } from "./palette/Palette.tsx";
import { SettingsSheet } from "./settings/SettingsSheet.tsx";

export type Page = "usage" | "work";

// ⌘1 / ⌘2 switch pages, ⌘K opens the palette, ⌘, opens Settings (keymap.md). Both pages stay mounted and only
// their visibility changes, so the terminal on the Work page is never unmounted and its PTY never restarts (R33).
export function App() {
  const [page, setPage] = useState<Page>("usage");
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "1") {
        e.preventDefault();
        setPage("usage");
      } else if (key === "2") {
        e.preventDefault();
        setPage("work");
      } else if (key === "k") {
        e.preventDefault();
        setSettings(false);
        setPalette(true);
      } else if (key === ",") {
        e.preventDefault();
        setPalette(false);
        setSettings(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Actions raised from inside the terminal (which swallows ⌘ chords before they bubble, R31) or a page.
  useEffect(
    () =>
      onAppAction((action) => {
        if (action === "go.usage") setPage("usage");
        else if (action === "go.work") setPage("work");
        else if (action === "palette") {
          setSettings(false);
          setPalette(true);
        } else if (action === "settings") {
          setPalette(false);
          setSettings(true);
        }
      }),
    [],
  );

  // The global hotkey (R30) brings the window forward in Rust, then asks for the palette.
  useEffect(() => {
    const stop = onOpenPalette(() => {
      setSettings(false);
      setPalette(true);
    });
    return () => void stop.then((u) => u());
  }, []);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Pages">
        <button
          type="button"
          className="rail-item"
          aria-current={page === "usage" ? "page" : undefined}
          onClick={() => setPage("usage")}
          title="Usage (⌘1)"
        >
          Usage
        </button>
        <button
          type="button"
          className="rail-item"
          aria-current={page === "work" ? "page" : undefined}
          onClick={() => setPage("work")}
          title="Work (⌘2)"
        >
          Work
        </button>
      </nav>
      <main className="content">
        <section className="page" data-page="usage" hidden={page !== "usage"}>
          <UsagePage active={page === "usage"} />
        </section>
        <section className="page" data-page="work" hidden={page !== "work"}>
          <WorkPage active={page === "work"} />
        </section>
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  );
}
