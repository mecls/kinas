import { useEffect, useMemo, useState } from "react";
import { crewErrorOf, getCrew, onCrewChanged, setCrewVisible, type CrewSnapshot } from "../api.ts";
import { latestOnly } from "../shell/latest.ts";

// The one crew reading (build spec §11.2), modelled on usage/useUsageSnapshot.ts: App holds it and hands it to the pages
// that show the crew, so they never read at two moments. Read again on `crew_changed` (the collector wrote the mirror),
// when the window comes forward, and every 30 s while the crew is showing, because "stale" ages without new data.

const RERENDER_MS = 30_000;

/** `showing`: a page that shows the crew is on screen — the collector runs its snapshot for it and every 60 s. */
export function useCrew(showing: boolean): { crew: CrewSnapshot | null; error: string | null; reload: () => void } {
  const [crew, setCrew] = useState<CrewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A failed read keeps the last reading (ADR 0004) and says so: the collector's own failure is in the reading, but a
  // reading that cannot be had at all would otherwise freeze every page that shows the crew — its "as of" never going
  // stale — with nothing on screen to tell why. Only the newest read counts (shell/latest.ts): a slow one must not put
  // an older mirror back over a fresher one.
  const reload = useMemo(
    () =>
      latestOnly(
        getCrew,
        (c) => {
          setCrew(c);
          setError(null);
        },
        (e: unknown) => setError(crewErrorOf(e)),
      ),
    [],
  );

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

  return { crew, error, reload };
}
