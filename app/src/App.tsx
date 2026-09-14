import { useEffect, useState } from "react";
import { UsagePage } from "./pages/Usage.tsx";
import { WorkPage } from "./pages/Work.tsx";

export type Page = "usage" | "work";

// ⌘1 / ⌘2 switch pages (keymap.md). Both pages stay mounted and only their visibility changes, so the
// terminal on the Work page is never unmounted and its PTY never restarts (R33).
export function App() {
  const [page, setPage] = useState<Page>("usage");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "1") {
        e.preventDefault();
        setPage("usage");
      } else if (e.key === "2") {
        e.preventDefault();
        setPage("work");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
          <UsagePage />
        </section>
        <section className="page" data-page="work" hidden={page !== "work"}>
          <WorkPage active={page === "work"} />
        </section>
      </main>
    </div>
  );
}
