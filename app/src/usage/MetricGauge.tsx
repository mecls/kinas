import type { ProviderMetricView, ReaderView } from "../api.ts";
import { metricLabel, metricValue, windowLabel } from "./convex.ts";
import { asOf, leftPct, tone, usedPct } from "./format.ts";

// A provider metric from `provider_metrics` (prd-convex-usage.md R4, R6, R8, R15).
//
// Deliberately not the `Gauge` component: that one takes a `QuotaView`, indexes a closed two-key
// PROVIDER_LABEL, and assumes a non-optional `used_pct` and a `resets_at`. A provider metric has an *optional*
// percentage, because a figure with no plan allowance has no denominator — so this renders a bar when there is
// one and a plain number when there is not, rather than fabricating a zero (R8).

/**
 * How a provider writes its own names, values and window labels.
 *
 * Convex's are the default because it was here first. Hostinger needs its own: its figures are **bytes**, and
 * Convex's formatter would render a month of traffic as "4,398,046,511,104 bytes" — true, unreadable, and
 * inconsistent with the MiB denominators beside it. Injecting the three functions keeps one gauge component
 * rather than forking it, and keeps each provider's wording in that provider's own module.
 */
export type MetricFormat = {
  label: (metric: string) => string;
  value: (used: number, unit: string | null) => string;
  window: (window: string) => string;
};

const CONVEX_FORMAT: MetricFormat = { label: metricLabel, value: metricValue, window: windowLabel };

export function MetricGauge({
  metric,
  reader,
  now,
  format = CONVEX_FORMAT,
}: {
  metric: ProviderMetricView;
  reader: ReaderView | undefined;
  now: number;
  format?: MetricFormat;
}) {
  const gauged = metric.used_pct !== null && metric.limit_value !== null;
  const hidden = metric.state === "dead";
  const left = metric.used_pct === null ? 100 : leftPct(metric.used_pct);

  return (
    <article
      className="gauge"
      data-provider={metric.provider}
      data-metric={metric.metric}
      data-window={metric.window}
      data-state={metric.state}
      title={`Source: ${metric.source}`}
    >
      <header className="gauge-head">
        <span className="gauge-label">{format.label(metric.metric)}</span>
        <span className={`dot dot-${metric.state}`} aria-label={metric.state} />
      </header>
      <div className="gauge-number">
        {hidden ? (
          "—"
        ) : gauged ? (
          <>
            {usedPct(metric.used_pct!)}
            <span className="gauge-unit">% used</span>
          </>
        ) : (
          format.value(metric.used, metric.unit)
        )}
      </div>
      <div className="gauge-bar" aria-hidden="true">
        {/* No bar without a denominator: a full-width bar would read as "all used", an empty one as "none". */}
        {!hidden && gauged && <div className={`gauge-fill tone-${tone(left)}`} style={{ width: `${Math.max(0, Math.min(100, metric.used_pct!))}%` }} />}
      </div>
      <p className="gauge-detail">
        {hidden
          ? (reader?.last_error ?? "no recent reading")
          : gauged
            ? `${format.value(metric.used, metric.unit)} of ${format.value(metric.limit_value!, metric.unit)} · ${format.window(metric.window)}`
            : format.window(metric.window)}
      </p>
      <p className={`gauge-asof${metric.state === "stale" ? " is-stale" : ""}`}>
        {asOf(metric.updated_at, now)}
        {metric.state === "stale" && " · stale"}
      </p>
    </article>
  );
}

/** The figures that have no plan allowance, listed under the gauges so a spike can be attributed (R7, R8). */
export function MetricFigures({ metrics, label }: { metrics: ProviderMetricView[]; label: string }) {
  if (metrics.length === 0) return null;
  // The window is named above the list, not per row: these are all one window, and an unlabelled "12,000 calls"
  // reads as a month total. `day` is UTC and says so, because it does not line up with the chart's Lisbon days.
  const caption = windowLabel(metrics[0]!.window);
  return (
    <>
      <p className="muted gauge-figures-caption">{caption}</p>
      <ul className="gauge-models" aria-label={label}>
        {metrics.map((m) => (
          <li key={`${m.metric}/${m.window}`} data-metric={m.metric} data-window={m.window}>
            <span className="gauge-model">{metricLabel(m.metric)}</span>
            <span className="gauge-model-count">{metricValue(m.used, m.unit)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Shown instead of gauges when Convex has no readings yet.
 *
 * The two reasons are distinguished, because they need different actions: no deploy key, or no deployment URL.
 * `reader.last_error` carries which one, since `record_poll` writes a different `NotConfigured` message for each.
 */
export function ConvexEmpty({ reader, onConnect }: { reader: ReaderView | undefined; onConnect: () => void }) {
  const needsSetup = !reader || reader.state === "not_configured";
  return (
    <article className="gauge gauge-empty" data-provider="convex" data-state={needsSetup ? "not_configured" : "dead"}>
      <header className="gauge-head">
        <span className="gauge-label">Convex</span>
        <span className={`dot ${needsSetup ? "dot-idle" : "dot-dead"}`} />
      </header>
      <div className="gauge-number">—</div>
      <p className="gauge-detail">{needsSetup ? (reader?.last_error ?? "No Convex deploy key saved.") : (reader?.last_error ?? "No reading yet.")}</p>
      {needsSetup && (
        <button type="button" className="button" onClick={onConnect}>
          Add deploy key
        </button>
      )}
    </article>
  );
}
