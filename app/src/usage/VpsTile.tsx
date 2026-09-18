import type { ProviderMetricView, ReaderView } from "../api.ts";
import { asOf } from "./format.ts";
import { metricLabel, metricValue, ofLimit } from "./hostinger.ts";

// The VPS as a tile rather than a row of gauges (prd-hostinger-usage.md R11).
//
// Deliberately not `MetricGauge`: CPU, RAM, disk and uptime are the live state of a running machine, and a
// progress bar on a number that moves every minute reads as an allowance being consumed. Only monthly bandwidth
// is a quota, and that one does go through `MetricGauge` on the page above.
//
// The markup mirrors `MacTiles` exactly — `.tiles` → `.tile[data-tile]` → `.tile-number` — so a VPS tile and the
// Mac tile beside it are the same object to the stylesheet, and neither drifts when the other is restyled.

export function VpsTile({ metrics, reader, now }: { metrics: ProviderMetricView[]; reader: ReaderView | undefined; now: number }) {
  if (metrics.length === 0) {
    return (
      <section className="tiles" aria-label="VPS" data-section="hostinger-tile">
        <p className="muted">{reader?.last_error ?? "No VPS connected — add a token in Settings."}</p>
      </section>
    );
  }

  // Every row of one poll carries the same machine, so the first row's detail names the tile.
  const machine = metrics[0]!.detail ?? "VPS";

  return (
    <section className="tiles" aria-label="VPS" data-section="hostinger-tile" data-state={metrics[0]!.state}>
      {metrics.map((m) => {
        const dead = m.state === "dead";
        const stale = m.state === "stale";
        const limit = ofLimit(m);
        return (
          <article className="tile" key={m.metric} data-tile={m.metric} data-metric={m.metric} data-state={m.state}>
            <header className="gauge-head">
              <span className="gauge-label">{metricLabel(m.metric)}</span>
              <span className={`dot dot-${m.state}`} aria-label={m.state} />
            </header>
            {/* A dead reading shows an em dash, never a stale number dressed as a current one. */}
            <div className="tile-number">{dead ? "—" : metricValue(m.used, m.unit)}</div>
            {dead ? (
              <p className="gauge-detail">{reader?.last_error ?? "no recent reading"}</p>
            ) : (
              limit && <p className="gauge-detail">{limit}</p>
            )}
            <p className={`gauge-asof${stale ? " is-stale" : ""}`}>
              {asOf(m.updated_at, now)}
              {stale && " · stale"} · {machine}
            </p>
          </article>
        );
      })}
    </section>
  );
}
