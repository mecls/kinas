import { useCallback, useEffect, useState } from "react";
import { getUsageSnapshot, onBackfillProgress, onReadingsChanged, setUsageVisible, type UsageSnapshot } from "../api.ts";

// The one usage poller (build-spec §11.1): App holds it and hands the snapshot to Home and Usage, so the two pages
// never read at two moments and never argue about whether usage is on screen. Lifted from the Usage page.

/** Staleness ages without new data, so the snapshot is re-read even when nothing changed (R12). */
const RERENDER_MS = 30_000;

/** `visible`: a page that shows readings is on screen — R13 speeds host sampling and refreshes Ollama for it. */
export function useUsageSnapshot(visible: boolean): { snapshot: UsageSnapshot | null; error: string | null } {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getUsageSnapshot().then(
      (s) => {
        setSnapshot(s);
        setError(null);
      },
      (e: unknown) => setError(String(e)),
    );
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, RERENDER_MS);
    const unlisteners = [onReadingsChanged(load), onBackfillProgress(load)];
    return () => {
      window.clearInterval(timer);
      for (const u of unlisteners) void u.then((stop) => stop());
    };
  }, [load]);

  useEffect(() => {
    const update = () => void setUsageVisible(visible && document.visibilityState === "visible").catch(() => {});
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    if (visible) load();
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [visible, load]);

  return { snapshot, error };
}
