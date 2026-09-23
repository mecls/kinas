import type { ProjectRow, UsageSnapshot } from "../api.ts";
import { seatFolders } from "../shell/folders.ts";
import { Button, EmptyState, Gauge, Gauges, MetricRow, ProgressList, ProgressRow, Rows, Section, SectionHeader, TitleRow } from "../ui/index.ts";
import { PROVIDER_LABEL, WINDOW_LABEL } from "../usage/format.ts";
import { asOfOldest, QuotaGauge } from "../usage/QuotaGauge.tsx";
import { attention, heroSlots } from "./home.ts";

// Home (DESIGN.md §5 Home; build-spec §4): the first screen, ⌘1. It answers what needs me: what happened overnight in
// each client folder, what is waiting on me, and the three readings that decide the day with anything past its
// threshold. Until the crew arrives (Build 3) nothing runs overnight and nothing waits, and each section says so —
// the "N waiting on you" button of the title row arrives with the Inbox, since today its count is always zero.
// Always mounted, like every page (App.tsx); `hidden` is the shell's.

export function HomePage({
  usage,
  usageError,
  projects,
  folder,
  onOpen,
  onGo,
  onLaunch,
}: {
  /** App's one usage snapshot (usage/useUsageSnapshot.ts), shared with the Usage page. */
  usage: UsageSnapshot | null;
  usageError: string | null;
  projects: readonly ProjectRow[];
  /** The folder the reader has open, so its row reads as selected. */
  folder: string | null;
  onOpen: (path: string) => void;
  onGo: (page: "usage") => void;
  onLaunch: () => void;
}) {
  const folders = seatFolders(projects);
  return (
    <div className="page-in home">
      <TitleRow title="Home">
        <Button kind="primary" onClick={onLaunch}>
          Launch task
        </Button>
      </TitleRow>

      <Section aria-label="Overnight" data-section="overnight">
        <SectionHeader title="Overnight" />
        {folders.length === 0 ? (
          <EmptyState>No client folders under the projects folder yet.</EmptyState>
        ) : (
          <ProgressList label="Client folders">
            {folders.map((f) => (
              <ProgressRow
                key={f.path}
                cat={f.cat}
                name={f.name}
                internal={f.internal}
                event="No work overnight in this folder."
                selected={f.path === folder}
                onSelect={() => onOpen(f.path)}
                title={f.display}
                data-folder={f.name}
                data-cat={f.cat}
              />
            ))}
          </ProgressList>
        )}
      </Section>

      <Section aria-label="Waiting on you" data-section="waiting">
        <SectionHeader title="Waiting on you" />
        <EmptyState>Nothing waiting on you.</EmptyState>
      </Section>

      <Section aria-label="Usage" data-section="usage">
        <HomeUsage snapshot={usage} error={usageError} onOpenUsage={() => onGo("usage")} />
      </Section>
    </div>
  );
}

function HomeUsage({ snapshot, error, onOpenUsage }: { snapshot: UsageSnapshot | null; error: string | null; onOpenUsage: () => void }) {
  const action = { label: "Open usage", onClick: onOpenUsage };
  if (!snapshot) {
    return (
      <>
        <SectionHeader title="Usage" action={action} />
        <p className={error ? "home-note home-error" : "home-note"}>{error ?? "Reading…"}</p>
      </>
    );
  }
  const reader = (id: "claude-plan" | "ollama-cloud") => snapshot.readers.find((r) => r.reader === id);
  const slots = heroSlots(snapshot);
  const readings = slots.flatMap((s) => (s.quota ? [s.quota] : []));
  const rows = attention(snapshot);
  return (
    <>
      <SectionHeader title="Usage" caption={asOfOldest(readings, snapshot.now)} source="Oldest reading on this section" action={action} />
      <Gauges>
        {slots.map((s) =>
          s.quota ? (
            <QuotaGauge key={`${s.subscription}/${s.window}`} quota={s.quota} reader={reader(s.subscription)} now={snapshot.now} />
          ) : (
            // No reading yet from this provider: the gauge in its place says so; Usage has the button that fixes it.
            <Gauge
              key={`${s.subscription}/${s.window}`}
              title={`${PROVIDER_LABEL[s.subscription]} · ${WINDOW_LABEL[s.window]}`}
              used={null}
              unit="% used"
              detail={reader(s.subscription)?.last_error ?? "Set up on the Usage page."}
              dead
              data-subscription={s.subscription}
              data-window={s.window}
              data-state="not_configured"
            />
          ),
        )}
      </Gauges>
      <div className="home-attn" data-section="attention">
        {rows.length === 0 ? (
          <p className="home-note">Everything else is within limits.</p>
        ) : (
          <Rows title="Needs attention">
            {rows.map((r) => (
              <MetricRow key={r.key} label={r.label} used={r.used} value={r.value} unit={r.unit} tone={r.tone} data-attention={r.key} data-tone={r.tone} />
            ))}
          </Rows>
        )}
      </div>
    </>
  );
}
