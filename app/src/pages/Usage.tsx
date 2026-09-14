import { useCallback, useEffect, useState } from "react";
import { dispatchAppAction } from "../actions.ts";
import { getUsageSnapshot, onBackfillProgress, onReadingsChanged, setUsageVisible, type ReaderId, type UsageSnapshot } from "../api.ts";
import { Gauge, ProviderEmpty } from "../usage/Gauge.tsx";
import { MacTiles } from "../usage/MacTiles.tsx";
import { UsageChart } from "../usage/UsageChart.tsx";

const PROVIDERS = ["claude-plan", "ollama-cloud"] as const;
/** Staleness ages without new data, so the page re-reads even when nothing changed (R12). */
const RERENDER_MS = 30_000;

export function UsagePage({ active }: { active: boolean }) {
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

  // R13: host sampling speeds up and Ollama refreshes when this page is actually on screen.
  useEffect(() => {
    const update = () => void setUsageVisible(active && document.visibilityState === "visible").catch(() => {});
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    if (active) load();
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [active, load]);

  if (!snapshot) {
    return (
      <div className="usage">
        <header className="page-header">
          <h1>Usage</h1>
        </header>
        <p className="muted usage-loading">{error ?? "Reading…"}</p>
      </div>
    );
  }

  const reader = (id: ReaderId) => snapshot.readers.find((r) => r.reader === id);

  return (
    <div className="usage">
      <header className="page-header">
        <h1>Usage</h1>
      </header>

      <section className="gauges" aria-label="Plans">
        {PROVIDERS.flatMap((provider) => {
          const quotas = snapshot.quotas.filter((q) => q.subscription === provider);
          if (quotas.length === 0) {
            return [<ProviderEmpty key={provider} provider={provider} reader={reader(provider)} onConnect={() => dispatchAppAction("settings")} />];
          }
          return quotas.map((q) => <Gauge key={`${q.subscription}/${q.window}`} quota={q} reader={reader(provider)} now={snapshot.now} />);
        })}
      </section>

      <section className="panel" aria-label="Model usage by day">
        <UsageChart snapshot={snapshot} />
      </section>

      <MacTiles host={snapshot.host} reader={reader("host")} now={snapshot.now} />
    </div>
  );
}
