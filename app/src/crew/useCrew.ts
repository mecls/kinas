import { useCallback, useEffect, useState } from "react";
import { getCrew, onCrewChanged, setCrewVisible, type CrewSnapshot } from "../api.ts";

// The one crew reading (build spec §11.2), modelled on usage/useUsageSnapshot.ts: App holds it and hands it to the pages
// that show the crew, so they never read at two moments. Read again on `crew_changed` (the collector wrote the mirror),
// when the window comes forward, and every 30 s while the crew is showing, because "stale" ages without new data.

const RERENDER_MS = 30_000;

/** `showing`: a page that shows the crew is on screen — the collector runs its snapshot for it and every 60 s. */
export function useCrew(showing: boolean): { crew: CrewSnapshot | null; reload: () => void } {
  const [crew, setCrew] = useState<CrewSnapshot | null>(null);

  // A failed read keeps the last reading (ADR 0004); the page's error line comes from the collector's own status.
  const reload = useCallback(() => void getCrew().then(setCrew, () => {}), []);

  useEffect(() => {
    reload();
    const unlisten = onCrewChanged(reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      void unlisten.then((stop) => stop());
    };
  }, [reload]);

  useEffect(() => {
    const update = () => void setCrewVisible(showing && document.visibilityState === "visible").catch(() => {});
    update();
    document.addEventListener("visibilitychange", update);
    if (!showing) return () => document.removeEventListener("visibilitychange", update);
    reload();
    const timer = window.setInterval(reload, RERENDER_MS);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [showing, reload]);

  return { crew, reload };
}
