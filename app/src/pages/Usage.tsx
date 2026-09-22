import { useCallback, useEffect, useState } from "react";
import { dispatchAppAction } from "../actions.ts";
import { getUsageSnapshot, onBackfillProgress, onReadingsChanged, setUsageVisible, type ReaderId, type UsageSnapshot } from "../api.ts";
import { BILLING_WINDOW, DETAIL, forWindow, GAUGED, NOT_AVAILABLE } from "../usage/convex.ts";
import { Gauge, ProviderEmpty } from "../usage/Gauge.tsx";
import {
  BILLING_WINDOW as VPS_BILLING_WINDOW,
  forWindow as vpsForWindow,
  GAUGED as VPS_GAUGED,
  metricLabel as vpsLabel,
  metricValue as vpsValue,
  NOT_AVAILABLE as VPS_NOT_AVAILABLE,
  TILE as VPS_TILE,
  windowLabel as vpsWindow,
} from "../usage/hostinger.ts";
import { MacTiles } from "../usage/MacTiles.tsx";
import { ConvexEmpty, MetricFigures, MetricGauge } from "../usage/MetricGauge.tsx";
import { UsageChart } from "../usage/UsageChart.tsx";
import { VpsTile } from "../usage/VpsTile.tsx";
import { TitleRow } from "../ui/index.ts";

const PROVIDERS = ["claude-plan", "ollama-cloud"] as const;
/** Hostinger's figures are bytes and milliseconds; Convex's formatter would render them as raw counts. */
const VPS_FORMAT = { label: vpsLabel, value: vpsValue, window: vpsWindow };
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
        <TitleRow title="Usage" />
        <p className="muted usage-loading">{error ?? "Reading…"}</p>
      </div>
    );
  }

  const reader = (id: ReaderId) => snapshot.readers.find((r) => r.reader === id);
  // The month window is what the plan's allowances are for (convex R6); the day figures sit in the detail list.
  const convexGauges = forWindow(snapshot.provider_metrics, "month", GAUGED);
  const convexMonthFigures = forWindow(snapshot.provider_metrics, "month", DETAIL);
  const convexToday = forWindow(snapshot.provider_metrics, "day", GAUGED);
  // Hostinger: the machine's live state is a tile, and only monthly bandwidth could ever be a gauge (R11).
  const vpsTile = vpsForWindow(snapshot.provider_metrics, "now", VPS_TILE);
  const vpsBandwidth = vpsForWindow(snapshot.provider_metrics, "month", VPS_GAUGED);

  return (
    <div className="usage">
      <TitleRow title="Usage" />

      <section className="gauges" aria-label="Plans">
        {PROVIDERS.flatMap((provider) => {
          const quotas = snapshot.quotas.filter((q) => q.subscription === provider);
          if (quotas.length === 0) {
            return [<ProviderEmpty key={provider} provider={provider} reader={reader(provider)} onConnect={() => dispatchAppAction("settings")} />];
          }
          return quotas.map((q) => <Gauge key={`${q.subscription}/${q.window}`} quota={q} reader={reader(provider)} now={snapshot.now} />);
        })}
      </section>

      <section className="gauges" aria-label="Convex" data-section="convex">
        {convexGauges.length === 0 ? (
          <ConvexEmpty reader={reader("convex")} onConnect={() => dispatchAppAction("settings")} />
        ) : (
          convexGauges.map((m) => <MetricGauge key={m.metric} metric={m} reader={reader("convex")} now={snapshot.now} />)
        )}
      </section>

      {/*
        A failing poll keeps the last numbers (R12) — which means without this line it would be *invisible*: the
        gauges look fine and only `reader_status` changed. `MetricGauge` shows the reader's error only once a
        reading has gone dead, and a rejected key does not age a reading. So the provider's error is said here,
        beside its gauges, while they keep the figures they last had.
      */}
      {reader("convex")?.state === "error" && reader("convex")?.last_error && (
        <p className="muted" data-testid="convex-error">
          Convex: {reader("convex")!.last_error} · showing the last reading
        </p>
      )}

      {convexGauges.length > 0 && (
        <section className="panel" aria-label="Convex detail" data-section="convex-detail">
          <MetricFigures metrics={convexToday} label="Convex today (UTC)" />
          <MetricFigures metrics={convexMonthFigures} label="Convex metrics without a plan allowance" />
          {/* The gauges above divide a calendar-month total by a billing-period allowance, because the API
              offers nothing else. Saying so is the difference between an upper bound and a wrong number. */}
          <p className="muted" data-testid="convex-billing-window">
            {BILLING_WINDOW}
          </p>
          {/* R15: said once, plainly, instead of placeholder gauges with nothing behind them. */}
          <p className="muted">{NOT_AVAILABLE}</p>
        </section>
      )}

      {(vpsTile.length > 0 || vpsBandwidth.length > 0 || reader("hostinger")?.state === "error") && (
        <section className="panel" aria-label="Hostinger VPS" data-section="hostinger">
          {/* Bandwidth first: it is the only quota here, and the only thing that can carry a bar. While its
              aggregation rule is unsettled the reader stores a NULL limit, so `MetricGauge` renders it as a
              plain figure — no branch needed here, and no bar that would be guessing. */}
          {vpsBandwidth.map((m) => (
            <MetricGauge key={m.metric} metric={m} reader={reader("hostinger")} now={snapshot.now} format={VPS_FORMAT} />
          ))}

          <VpsTile metrics={vpsTile} reader={reader("hostinger")} now={snapshot.now} />

          {/* A failing poll keeps the last numbers, so without this line it would be invisible: the tile looks
              fine and only `reader_status` changed. */}
          {reader("hostinger")?.state === "error" && reader("hostinger")?.last_error && (
            <p className="muted" data-testid="hostinger-error">
              Hostinger: {reader("hostinger")!.last_error} · showing the last reading
            </p>
          )}

          {vpsBandwidth.length > 0 && (
            <p className="muted" data-testid="hostinger-billing-window">
              {VPS_BILLING_WINDOW}
            </p>
          )}
          <p className="muted">{VPS_NOT_AVAILABLE}</p>
        </section>
      )}

      <section className="panel" aria-label="Model usage by day">
        <UsageChart snapshot={snapshot} />
      </section>

      <MacTiles host={snapshot.host} reader={reader("host")} now={snapshot.now} />
    </div>
  );
}
