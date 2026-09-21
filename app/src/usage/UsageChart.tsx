import { useEffect, useMemo, useRef, useState } from "react";
import type { UsageSnapshot } from "../api.ts";
import { buildChart } from "./chartModel.ts";
import { compactTokens } from "./format.ts";

// Model usage by day (R38): the last 30 Europe/Lisbon days, stacked columns by harness·model, hand-drawn
// SVG. Marks follow the dataviz specs: columns ≤ 24 px, 4 px rounded tops, a 2 px surface gap between
// segments, hairline grid; a legend, a per-day hover/focus readout, and a table view as its twin.

const HEIGHT = 190;
const PAD = { left: 48, right: 8, top: 10, bottom: 24 };
const GAP = 2;
const RADIUS = 4;

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const shortDate = (date: string) => date.slice(5);

export function UsageChart({ snapshot }: { snapshot: UsageSnapshot }) {
  const [includeCache, setIncludeCache] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(260, el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => buildChart(snapshot, includeCache), [snapshot, includeCache]);
  const slots = new Map(model.series.map((s) => [s.key, s.slot]));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const top = model.ticks.at(-1) || 1;
  const slotW = plotW / Math.max(1, model.days.length);
  const barW = Math.min(24, Math.max(3, slotW - 6));
  const baseline = PAD.top + plotH;
  const y = (v: number) => baseline - (v / top) * plotH;
  const firstDataIndex = model.days.findIndex((d) => !d.noData);
  const hovered = hover === null ? null : model.days[hover];

  return (
    <>
      <div className="chart-head">
        <h2 className="chart-title">Model usage by day · tokens</h2>
        <div className="chart-controls">
          <label>
            <input type="checkbox" checked={includeCache} onChange={(e) => setIncludeCache(e.currentTarget.checked)} />
            include cache reads
          </label>
        </div>
      </div>
      {snapshot.backfill.running && (
        <p className="muted chart-note" data-testid="backfill">
          Reading history… {snapshot.backfill.done}/{snapshot.backfill.total} files
        </p>
      )}
      {snapshot.first_usage_date === null ? (
        <p className="muted chart-note">No transcripts read yet.</p>
      ) : (
        firstDataIndex > 0 && <p className="muted chart-note">No data before {snapshot.first_usage_date}.</p>
      )}

      <div className="chart-wrap" ref={wrap} onMouseLeave={() => setHover(null)}>
        <svg className="chart-svg" width={width} height={HEIGHT} role="img" aria-label="Tokens per day for the last 30 days">
          <defs>
            <pattern id="kinas-no-data" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="chart-hatch" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>

          {model.ticks.map((t) => (
            <g key={t}>
              {t > 0 && <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />}
              <text className="chart-tick" x={PAD.left - 8} y={y(t) + 3} textAnchor="end">
                {compactTokens(t)}
              </text>
            </g>
          ))}

          {model.days.map((day, i) => {
            const x = PAD.left + i * slotW + (slotW - barW) / 2;
            if (day.noData) {
              return <rect key={day.date} className="chart-nodata" data-nodata={day.date} x={x} y={PAD.top} width={barW} height={plotH} />;
            }
            let cursor = baseline;
            return (
              <g key={day.date} data-date={day.date}>
                {day.segments.map((seg, s) => {
                  const h = (seg.value / top) * plotH;
                  const isTop = s === day.segments.length - 1;
                  const segTop = cursor - h;
                  const drawnTop = isTop ? segTop : segTop + GAP;
                  const drawnH = Math.max(0, cursor - drawnTop);
                  cursor = segTop;
                  const fill = `var(--series-${slots.get(seg.key) ?? 8})`;
                  return isTop ? (
                    <path key={seg.key} d={roundedTop(x, drawnTop, barW, drawnH)} fill={fill} />
                  ) : (
                    <rect key={seg.key} x={x} y={drawnTop} width={barW} height={drawnH} fill={fill} />
                  );
                })}
              </g>
            );
          })}

          <line className="chart-baseline" x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} />
          {model.days.map((day, i) =>
            i % 7 === 0 || i === model.days.length - 1 ? (
              <text key={day.date} className="chart-tick" x={PAD.left + i * slotW + slotW / 2} y={HEIGHT - 6} textAnchor="middle">
                {shortDate(day.date)}
              </text>
            ) : null,
          )}

          {model.days.map((day, i) => (
            <rect
              key={`hit-${day.date}`}
              className="chart-hit"
              x={PAD.left + i * slotW}
              y={PAD.top}
              width={slotW}
              height={plotH}
              tabIndex={0}
              aria-label={day.noData ? `${day.date}: no data` : `${day.date}: ${compactTokens(day.total)} tokens`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>

        {hovered && hover !== null && (
          <div
            className="tooltip"
            role="status"
            style={{ left: Math.min(width - 200, Math.max(0, PAD.left + hover * slotW + slotW / 2 - 90)), top: 0 }}
          >
            <div className="tooltip-date">
              {hovered.date} · {hovered.noData ? "no data" : `${compactTokens(hovered.total)} tokens`}
            </div>
            {hovered.segments
              .slice()
              .reverse()
              .map((seg) => (
                <div className="tooltip-row" key={seg.key}>
                  <span className="tooltip-key" style={{ background: `var(--series-${slots.get(seg.key) ?? 8})` }} />
                  <span>{seg.key}</span>
                  <span className="tooltip-value">{compactTokens(seg.value)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {model.series.length > 0 && (
        <ul className="legend" aria-label="Series">
          {model.series.map((s) => (
            <li key={s.key}>
              <span className="swatch" style={{ background: `var(--series-${s.slot})` }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Series</th>
              <th className="num">In</th>
              <th className="num">Cache read</th>
              <th className="num">Out</th>
              <th className="num">Messages</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.usage
              .slice()
              .reverse()
              .map((r) => (
                <tr key={`${r.date}|${r.harness}|${r.provider}|${r.model}`}>
                  <td>{r.date}</td>
                  <td>
                    {r.harness} · {r.model}
                  </td>
                  <td className="num">{r.tokens_in.toLocaleString("en-US")}</td>
                  <td className="num">{r.tokens_cache_read.toLocaleString("en-US")}</td>
                  <td className="num">{r.tokens_out.toLocaleString("en-US")}</td>
                  <td className="num">{r.messages.toLocaleString("en-US")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
