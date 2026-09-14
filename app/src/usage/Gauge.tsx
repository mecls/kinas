import type { QuotaView, ReaderView } from "../api.ts";
import { PROVIDER_LABEL, WINDOW_LABEL, asOf, leftPct, lisbonClock, resetsIn, tone, usedPct } from "./format.ts";

// One quota window (R38). The number never lies: a dead reading shows "—" and why, a reset window shows
// "—" because the stored number belongs to a window that ended, and a stale one keeps its number in gold.
// The bar fills with what is used, like the providers' own pages; its colour still warns by what is left.
// Ollama's number reads "% used", like ollama.com, and lists the requests per model it reports.

export function Gauge({ quota, reader, now }: { quota: QuotaView; reader: ReaderView | undefined; now: number }) {
  const label = `${PROVIDER_LABEL[quota.subscription]} · ${WINDOW_LABEL[quota.window]}`;
  const left = leftPct(quota.used_pct);
  const hidden = quota.state === "dead" || quota.state === "reset";
  const showsUsed = quota.subscription === "ollama-cloud";
  const models = [...quota.models].sort((a, b) => b.request_count - a.request_count || a.name.localeCompare(b.name));

  let detail: string;
  if (quota.state === "reset") {
    detail = `reset at ${quota.resets_at === null ? "—" : lisbonClock(quota.resets_at, now)} · waiting for a new reading`;
  } else if (quota.state === "dead") {
    detail = reader?.last_error ?? "no recent reading";
  } else {
    detail = resetsIn(quota.resets_at, now);
  }

  return (
    <article
      className="gauge"
      data-subscription={quota.subscription}
      data-window={quota.window}
      data-state={quota.state}
      title={`Source: ${quota.source}`}
    >
      <header className="gauge-head">
        <span className="gauge-label">{label}</span>
        {quota.plan && <span className="gauge-plan">{quota.plan}</span>}
        <span className={`dot dot-${quota.state}`} aria-label={quota.state} />
      </header>
      <div className="gauge-number">
        {hidden ? (
          "—"
        ) : showsUsed ? (
          <>
            {usedPct(quota.used_pct)}
            <span className="gauge-unit">% used</span>
          </>
        ) : (
          <>
            {left}
            <span className="gauge-unit">% left</span>
          </>
        )}
      </div>
      <div className="gauge-bar" aria-hidden="true">
        {!hidden && <div className={`gauge-fill tone-${tone(left)}`} style={{ width: `${Math.max(0, Math.min(100, quota.used_pct))}%` }} />}
      </div>
      <p className="gauge-detail">{detail}</p>
      {!hidden && models.length > 0 && (
        <ul className="gauge-models" aria-label={`Requests per model this ${WINDOW_LABEL[quota.window]}`}>
          {models.map((m) => (
            <li key={m.name} data-model={m.name}>
              <span className="gauge-model">{m.name}</span>
              <span className="gauge-model-count">
                {m.request_count} {m.request_count === 1 ? "request" : "requests"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={`gauge-asof${quota.state === "stale" ? " is-stale" : ""}`}>
        {asOf(quota.updated_at, now)}
        {quota.state === "stale" && " · stale"}
      </p>
    </article>
  );
}

/** Shown instead of gauges when a provider has no readings yet. */
export function ProviderEmpty({
  provider,
  reader,
  onConnect,
}: {
  provider: "claude-plan" | "ollama-cloud";
  reader: ReaderView | undefined;
  onConnect: () => void;
}) {
  const label = PROVIDER_LABEL[provider];
  const needsSetup = !reader || reader.state === "not_configured";
  const action = provider === "claude-plan" ? "Connect Claude Code" : "Add API key";
  return (
    <article className="gauge gauge-empty" data-subscription={provider} data-state={needsSetup ? "not_configured" : "dead"}>
      <header className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className={`dot ${needsSetup ? "dot-idle" : "dot-dead"}`} />
      </header>
      <div className="gauge-number">—</div>
      <p className="gauge-detail">{needsSetup ? (provider === "claude-plan" ? "No reading from Claude Code yet." : "No Ollama Cloud key saved.") : (reader?.last_error ?? "No reading yet.")}</p>
      {needsSetup && (
        <button type="button" className="button" onClick={onConnect}>
          {action}
        </button>
      )}
    </article>
  );
}
