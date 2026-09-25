import type { ReactNode } from "react";
import { dispatchAppAction } from "../actions.ts";
import type { CrewSnapshot, HostView, ProviderMetricView, QuotaView, ReaderId, ReaderView, UsageSnapshot } from "../api.ts";
import * as convex from "../usage/convex.ts";
import { asOf, gb, gib, tone, usedPct, WINDOW_LABEL } from "../usage/format.ts";
import * as hostinger from "../usage/hostinger.ts";
import { asOfOldest, QuotaGauge, quotaDetail, shownUsed, sourcesOf } from "../usage/QuotaGauge.tsx";
import { CrewSection } from "../usage/CrewSection.tsx";
import { UsageChart } from "../usage/UsageChart.tsx";
import { Card, EmptyState, Gauges, MetricRow, Rows, Section, SectionHeader, Table, TitleRow } from "../ui/index.ts";

// The Usage page (DESIGN.md §5 Usage; build-spec §4): it answers how much of what we pay for is left. A hero row of the
// three gauges that decide the day, then one section per provider with a single freshness caption. Every number and
// every data-* attribute is the one the page had before the design system; only the clothes changed.

const PROVIDERS = ["claude-plan", "ollama-cloud"] as const;
type Provider = (typeof PROVIDERS)[number];
/** The windows in the order a provider's gauges read; the hero takes the first one Ollama reports. */
const WINDOW_ORDER = ["week", "session", "month_credits"] as const;
const OLLAMA_ORDER = ["session", "week", "month_credits"] as const;
/** The snapshot comes from App's one poller (usage/useUsageSnapshot.ts), shared with Home; the crew from App's one crew
 *  reading (crew/useCrew.ts). */
export function UsagePage({ snapshot, error, crew = null }: { snapshot: UsageSnapshot | null; error: string | null; crew?: CrewSnapshot | null }) {
  if (!snapshot) {
    return (
      <div className="usage">
        <TitleRow title="Usage" />
        <p className="usage-note">{error ?? "Reading…"}</p>
      </div>
    );
  }

  const reader = (id: ReaderId) => snapshot.readers.find((r) => r.reader === id);
  const quotasOf = (provider: Provider, order: readonly string[]) =>
    snapshot.quotas.filter((q) => q.subscription === provider).sort((a, b) => order.indexOf(a.window) - order.indexOf(b.window));
  const claude = quotasOf("claude-plan", WINDOW_ORDER);
  const ollama = quotasOf("ollama-cloud", OLLAMA_ORDER);
  const settings = () => dispatchAppAction("settings");

  return (
    <div className="usage">
      <TitleRow title="Usage" />

      <Gauges>
        {claude.length === 0 ? (
          <ProviderEmpty provider="claude-plan" reader={reader("claude-plan")} onConnect={settings} />
        ) : (
          claude.map((q) => <QuotaGauge key={q.window} quota={q} reader={reader("claude-plan")} now={snapshot.now} />)
        )}
        {ollama.length === 0 ? (
          <ProviderEmpty provider="ollama-cloud" reader={reader("ollama-cloud")} onConnect={settings} />
        ) : (
          <QuotaGauge quota={ollama[0]!} reader={reader("ollama-cloud")} now={snapshot.now} />
        )}
      </Gauges>

      <Section className="usage-provider" data-section="claude">
        <SectionHeader title="Claude" caption={asOfOldest(claude, snapshot.now)} source={sourcesOf(claude)} />
        <UsageChart snapshot={snapshot} />
      </Section>

      {ollama.length > 0 && <OllamaSection quotas={ollama} now={snapshot.now} />}

      <ConvexSection metrics={snapshot.provider_metrics} reader={reader("convex")} now={snapshot.now} onConnect={settings} />

      <HostingerSection metrics={snapshot.provider_metrics} reader={reader("hostinger")} now={snapshot.now} />

      <MacSection host={snapshot.host} reader={reader("host")} now={snapshot.now} />

      <CrewSection crew={crew} />
    </div>
  );
}

/** A provider with no readings yet: what is missing, in one sentence, and the one action that fixes it. */
function ProviderEmpty({ provider, reader, onConnect }: { provider: Provider | "convex"; reader: ReaderView | undefined; onConnect: () => void }) {
  const needsSetup = !reader || reader.state === "not_configured";
  const copy: Record<Provider | "convex", { title: string; missing: string; action: string }> = {
    "claude-plan": { title: "Claude", missing: "No reading from Claude Code yet.", action: "Connect Claude Code" },
    "ollama-cloud": { title: "Ollama", missing: "No Ollama Cloud key saved.", action: "Add API key" },
    // Convex says which of its two settings is missing: `record_poll` writes a different message for each.
    convex: { title: "Convex", missing: reader?.last_error ?? "No Convex deploy key saved.", action: "Add deploy key" },
  };
  const { title, missing, action } = copy[provider];
  const ids = provider === "convex" ? { "data-provider": "convex" } : { "data-subscription": provider };
  return (
    <article className="ui-gauge usage-empty" data-state={needsSetup ? "not_configured" : "dead"} {...ids}>
      <div className="ui-gauge-title">{title}</div>
      <EmptyState action={needsSetup ? { label: action, onClick: onConnect } : undefined}>{needsSetup ? missing : (reader?.last_error ?? "No reading yet.")}</EmptyState>
    </article>
  );
}

/** Ollama: the windows the hero row does not show, as rows, then the requests each window reports per model. */
function OllamaSection({ quotas, now }: { quotas: QuotaView[]; now: number }) {
  return (
    <Section className="usage-provider" data-section="ollama">
      <SectionHeader title="Ollama" caption={asOfOldest(quotas, now)} source={sourcesOf(quotas)} />
      {quotas.length > 1 && (
        <Rows>
          {quotas.slice(1).map((q) => {
            const used = shownUsed(q);
            return (
              <MetricRow
                key={q.window}
                label={`This ${WINDOW_LABEL[q.window]}`}
                used={used}
                value={used === null ? "—" : `${used}%`}
                unit={used === null ? quotaDetail(q, undefined, now) : `used · ${quotaDetail(q, undefined, now)}`}
                tone={tone(q.used_pct, q.state)}
                data-subscription={q.subscription}
                data-window={q.window}
                data-state={q.state}
              />
            );
          })}
        </Rows>
      )}
      {quotas
        .filter((q) => q.models.length > 0 && q.state !== "dead" && q.state !== "reset")
        .map((q) => (
          <Table
            key={q.window}
            className="usage-table"
            data-requests-window={q.window}
            caption={`Requests by model · this ${WINDOW_LABEL[q.window]}`}
            columns={[
              { key: "model", label: "Model" },
              { key: "requests", label: "Requests", align: "right" },
            ]}
            rows={[...q.models]
              .sort((a, b) => b.request_count - a.request_count || a.name.localeCompare(b.name))
              .map((m) => ({ model: m.name, requests: m.request_count.toLocaleString("en-GB") }))}
            rowKey={(row) => String(row.model)}
            rowProps={(row) => ({ "data-model": String(row.model) })}
          />
        ))}
    </Section>
  );
}

/** A provider metric as a row: a bar only with an allowance, and a dead reading as "—" with the reader's reason. */
function metricRow(
  m: ProviderMetricView,
  format: { label: (metric: string) => string; value: (used: number, unit: string | null) => string },
  reader: ReaderView | undefined,
  opts: { bar: boolean },
): ReactNode {
  const dead = m.state === "dead";
  const gauged = opts.bar && m.used_pct !== null && m.limit_value !== null;
  let unit: string;
  if (dead) unit = reader?.last_error ?? "no recent reading";
  else if (gauged) unit = `of ${format.value(m.limit_value!, m.unit)} · ${usedPct(m.used_pct!)}% used${m.used_pct! > 100 ? " · upper bound" : ""}`;
  else if (m.limit_value !== null) unit = `of ${format.value(m.limit_value, m.unit)}`;
  else unit = "";
  return (
    <MetricRow
      key={`${m.metric}/${m.window}`}
      label={format.label(m.metric)}
      used={dead || !gauged ? null : m.used_pct}
      value={dead ? "—" : format.value(m.used, m.unit)}
      unit={m.state === "stale" ? `${unit} · stale` : unit}
      tone={tone(m.used_pct, m.state)}
      data-provider={m.provider}
      data-metric={m.metric}
      data-window={m.window}
      data-state={m.state}
    />
  );
}

/** A reader whose poll failed keeps its last numbers (R12) — so the failure is said beside them, or it is invisible. */
function ReaderError({ name, reader, testId }: { name: string; reader: ReaderView | undefined; testId: string }) {
  if (reader?.state !== "error" || !reader.last_error) return null;
  return (
    <p className="usage-note" data-testid={testId}>
      {name}: {reader.last_error} · showing the last reading
    </p>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Convex: the month against the plan's allowances (an upper bound, said), then today's figures and the rest. */
function ConvexSection({ metrics, reader, now, onConnect }: { metrics: ProviderMetricView[]; reader: ReaderView | undefined; now: number; onConnect: () => void }) {
  const month = convex.forWindow(metrics, "month", convex.GAUGED);
  if (month.length === 0) {
    return (
      <Section className="usage-provider" data-section="convex">
        <SectionHeader title="Convex" />
        <ProviderEmpty provider="convex" reader={reader} onConnect={onConnect} />
      </Section>
    );
  }
  const today = convex.forWindow(metrics, "day", convex.GAUGED);
  const figures = convex.forWindow(metrics, "month", convex.DETAIL);
  const shown = [...month, ...today, ...figures];
  const format = { label: convex.metricLabel, value: convex.metricValue };
  return (
    <Section className="usage-provider" data-section="convex">
      <SectionHeader title="Convex" caption={asOfOldest(shown, now)} source={sourcesOf(shown)} info={convex.BILLING_WINDOW} />
      <Rows title={sentence(convex.windowLabel("month"))} data-section="convex-month">
        {month.map((m) => metricRow(m, format, reader, { bar: true }))}
      </Rows>
      <ReaderError name="Convex" reader={reader} testId="convex-error" />
      <div className="usage-stack" data-section="convex-detail">
        {today.length > 0 && <Rows title={sentence(convex.windowLabel("day"))}>{today.map((m) => metricRow(m, format, reader, { bar: false }))}</Rows>}
        {figures.length > 0 && <Rows title="Without a plan allowance · calendar month to date (UTC)">{figures.map((m) => metricRow(m, format, reader, { bar: false }))}</Rows>}
        {/* The rows divide a calendar-month total by a billing-period allowance, because the API offers nothing else.
            Saying so is the difference between an upper bound and a wrong number. */}
        <p className="usage-note" data-testid="convex-billing-window">
          {convex.BILLING_WINDOW}
        </p>
        {/* R15: said once, plainly, instead of placeholder rows with nothing behind them. */}
        <p className="usage-note">{convex.NOT_AVAILABLE}</p>
      </div>
    </Section>
  );
}

/**
 * The Hostinger VPS: one card named for the machine (`hostname · plan · state`, from the rows' own detail), its live
 * state as rows without bars — a bar on a number that moves every minute reads as an allowance being consumed (R11)
 * — and the month's traffic as a figure until its allowance's window is settled (R10).
 */
function HostingerSection({ metrics, reader, now }: { metrics: ProviderMetricView[]; reader: ReaderView | undefined; now: number }) {
  const live = hostinger.forWindow(metrics, "now", hostinger.TILE);
  const bandwidth = hostinger.forWindow(metrics, "month", hostinger.GAUGED);
  if (live.length === 0 && bandwidth.length === 0 && reader?.state !== "error") return null;
  const shown = [...live, ...bandwidth];
  const machine = live[0]?.detail ?? bandwidth[0]?.detail ?? "VPS";
  const format = { label: hostinger.metricLabel, value: hostinger.metricValue };
  return (
    <Section className="usage-provider" data-section="hostinger">
      <SectionHeader title="Hostinger VPS" caption={asOfOldest(shown, now)} source={sourcesOf(shown)} />
      {shown.length === 0 ? (
        <p className="usage-note">{reader?.last_error ?? "No VPS connected — add a token in Settings."}</p>
      ) : (
        <Card title={machine} data-machine={machine}>
          {live.map((m) => metricRow(m, format, reader, { bar: false }))}
          {bandwidth.map((m) => (
            <MetricRow
              key={m.metric}
              label={hostinger.metricLabel(m.metric)}
              used={null}
              value={m.state === "dead" ? "—" : hostinger.metricValue(m.used, m.unit)}
              unit={m.state === "dead" ? (reader?.last_error ?? "no recent reading") : hostinger.windowLabel(m.window)}
              data-provider={m.provider}
              data-metric={m.metric}
              data-window={m.window}
              data-state={m.state}
            />
          ))}
        </Card>
      )}
      <ReaderError name="Hostinger" reader={reader} testId="hostinger-error" />
      {bandwidth.length > 0 && (
        <p className="usage-note" data-testid="hostinger-billing-window">
          {hostinger.BILLING_WINDOW}
        </p>
      )}
      <p className="usage-note">{hostinger.NOT_AVAILABLE}</p>
    </Section>
  );
}

/**
 * This Mac (R27): CPU, memory used of total, and disk as Finder shows it — "available" counts the purgeable space
 * macOS clears for you, in decimal GB — with the space free right now beside it. CPU moves every sample, so no bar.
 */
function MacSection({ host, reader, now }: { host: HostView | null; reader: ReaderView | undefined; now: number }) {
  if (!host) {
    return (
      <Section className="usage-provider" data-section="host">
        <SectionHeader title="This Mac" />
        <p className="usage-note">{reader?.last_error ?? "Reading this Mac…"}</p>
      </Section>
    );
  }
  const dead = host.state === "dead";
  const stale = host.state === "stale" ? " · stale" : "";
  const free = host.disk_total_gb - host.disk_used_gb;
  const available = host.disk_available_gb;
  const memPct = host.mem_total_gb > 0 ? (host.mem_used_gb / host.mem_total_gb) * 100 : null;
  const diskPct = host.disk_total_gb > 0 ? (host.disk_used_gb / host.disk_total_gb) * 100 : null;
  const bar = (pct: number | null) => (dead ? null : pct);
  return (
    <Section className="usage-provider" data-section="host">
      <SectionHeader title="This Mac" caption={`${asOf(host.updated_at, now)}${stale}`} source={host.machine} />
      <Rows data-state={host.state}>
        <MetricRow label="CPU" used={null} value={host.cpu_pct === null || dead ? "—" : `${Math.round(host.cpu_pct)}%`} unit="all cores" data-metric="cpu" />
        <MetricRow label="Memory" used={bar(memPct)} value={dead ? "—" : gib(host.mem_used_gb)} unit={`of ${gib(host.mem_total_gb)} used`} tone={tone(memPct, host.state)} data-metric="memory" />
        <MetricRow
          label="Disk"
          used={bar(diskPct)}
          value={dead ? "—" : gb(available ?? free)}
          unit={available === null ? `free of ${gb(host.disk_total_gb)}` : `available of ${gb(host.disk_total_gb)} · ${gb(free)} free now`}
          tone={tone(diskPct, host.state)}
          data-metric="disk"
        />
      </Rows>
    </Section>
  );
}
