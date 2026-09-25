import type { KeyboardEvent } from "react";
import type { CrewDecision, CrewSnapshot, ProjectRow, UsageSnapshot } from "../api.ts";
import { ageText, copiedText, titleOf } from "../crew/inbox.ts";
import { seatFolders, shownFolders } from "../shell/folders.ts";
import { Button, EmptyState, Gauge, Gauges, InboxItem, MetricRow, ProgressList, ProgressRow, Rows, Section, SectionHeader, TitleRow } from "../ui/index.ts";
import { inboxKey } from "../ui/inboxKeys.ts";
import { PROVIDER_LABEL, WINDOW_LABEL } from "../usage/format.ts";
import { asOfOldest, QuotaGauge } from "../usage/QuotaGauge.tsx";
import { attention, heroSlots } from "./home.ts";
import { overnightRows, sinceCaption } from "./overnight.ts";

// Home (DESIGN.md §5 Home; build-spec §4): the first screen, ⌘1. It answers what needs me: what happened overnight in
// each client folder, what is waiting on me, and the three readings that decide the day with anything past its
// threshold. Amended 2026-09-25 (the first mate, slice 7): with a crew, each folder's row counts its tasks with activity
// since the end of the captain's last session and opens the one that matters in the panel; Waiting on you holds the
// newest three decisions as compact items (Approve here, Answer and Deny on the Inbox); the title row holds the one
// waiting count. Without a crew every section is as before. Always mounted, like every page (App.tsx); `hidden` is the
// shell's.

/** Home shows this many waiting items; the rest are one click away on the Inbox. */
const WAITING_SHOWN = 3;

export function HomePage({
  usage,
  usageError,
  projects,
  folder,
  onOpen,
  onGo,
  onLaunch,
  crew = null,
  onSelectTask = () => {},
  onApprove = () => {},
  onOpenBox = () => {},
}: {
  /** App's one usage snapshot (usage/useUsageSnapshot.ts), shared with the Usage page. */
  usage: UsageSnapshot | null;
  usageError: string | null;
  projects: readonly ProjectRow[];
  /** The folder the reader has open, so its row reads as selected. */
  folder: string | null;
  onOpen: (path: string) => void;
  onGo: (page: "usage" | "inbox") => void;
  onLaunch: () => void;
  /** App's one crew reading (crew/useCrew.ts); null, or not installed, and Home is as before the crew. */
  crew?: CrewSnapshot | null;
  /** A row's most important task, opened in the right panel. */
  onSelectTask?: (id: string) => void;
  onApprove?: (task: string, key: string) => void;
  onOpenBox?: (task: string, key: string, kind: "answer" | "deny") => void;
}) {
  // Seated over every folder, then only the shown ones (folder views, 2026-09-23): a hidden folder is off Home too.
  const seated = seatFolders(projects);
  const folders = shownFolders(seated);
  const withCrew = crew !== null && crew.page !== "uninstalled";
  const night = withCrew ? overnightRows(folders, crew.tasks, crew.overnight_since, crew.decisions) : [];
  const waiting = withCrew ? crew.decisions : [];
  return (
    <div className="page-in home">
      <TitleRow title="Home">
        {withCrew && crew.waiting > 0 && (
          <Button data-testid="home-waiting" onClick={() => onGo("inbox")}>
            {crew.waiting} waiting on you
          </Button>
        )}
        <Button kind="primary" onClick={onLaunch}>
          Launch task
        </Button>
      </TitleRow>

      <Section aria-label="Overnight" data-section="overnight">
        <SectionHeader
          title="Overnight"
          caption={withCrew ? sinceCaption(crew.overnight_since, crew.now) : undefined}
          source={withCrew ? "the crew's timeline in Kinas" : undefined}
        />
        {projects.length === 0 ? (
          <EmptyState>No client folders under the projects folder yet.</EmptyState>
        ) : folders.length === 0 ? (
          <EmptyState>No client folder is shown. Settings → Client folders shows them again.</EmptyState>
        ) : (
          <ProgressList label="Client folders">
            {folders.map((f, i) => {
              const r = night[i];
              return (
                <ProgressRow
                  key={f.path}
                  cat={f.cat}
                  name={f.name}
                  internal={f.internal}
                  event={r?.event ?? "No work overnight in this folder."}
                  seg={r?.seg ?? undefined}
                  badges={r?.badges}
                  selected={f.path === folder}
                  // A row with work overnight opens the task that matters; a quiet one opens the folder, as before.
                  onSelect={() => (r?.target ? onSelectTask(r.target) : onOpen(f.path))}
                  title={f.display}
                  data-folder={f.name}
                  data-cat={f.cat}
                  data-target={r?.target ?? undefined}
                />
              );
            })}
          </ProgressList>
        )}
      </Section>

      <Section aria-label="Waiting on you" data-section="waiting">
        <SectionHeader
          title="Waiting on you"
          action={waiting.length > WAITING_SHOWN ? { label: `All ${waiting.length} in Inbox`, onClick: () => onGo("inbox") } : undefined}
        />
        {waiting.length === 0 ? (
          <EmptyState>Nothing waiting on you.</EmptyState>
        ) : (
          <ul className="ui-inbox inbox-list">
            {waiting.slice(0, WAITING_SHOWN).map((d) => (
              <Waiting key={`${d.task_id}\u0000${d.key}`} d={d} folders={seated} now={crew!.now} onApprove={onApprove} onOpenBox={onOpenBox} />
            ))}
          </ul>
        )}
      </Section>

      <Section aria-label="Usage" data-section="usage">
        <HomeUsage snapshot={usage} error={usageError} onOpenUsage={() => onGo("usage")} />
      </Section>
    </div>
  );
}

/** A compact inbox item (DESIGN.md §4, 1.7): A approves here; R and D open it on the Inbox with its box open. */
function Waiting({
  d,
  folders,
  now,
  onApprove,
  onOpenBox,
}: {
  d: CrewDecision;
  folders: readonly ReturnType<typeof seatFolders>[number][];
  now: number;
  onApprove: (task: string, key: string) => void;
  onOpenBox: (task: string, key: string, kind: "answer" | "deny") => void;
}) {
  const folder = d.repo ? folders.find((f) => !f.removed && f.repo === d.repo) : undefined;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = inboxKey(e, { boxOpen: false });
    if (!action) return;
    e.preventDefault();
    if (action === "approve") onApprove(d.task_id, d.key);
    else onOpenBox(d.task_id, d.key, action);
  };
  return (
    <li className="inbox-item" data-task={d.task_id} data-key={d.key} data-verb={d.verb}>
      <InboxItem
        cat={folder?.cat}
        compact
        keys
        tabIndex={0}
        onKeyDown={onKeyDown}
        question={d.summary || titleOf(d)}
        context={`${d.verb === "captain-hold" ? "Held for you · " : ""}${titleOf(d)} · ${ageText(d.opened_at, now)}`}
        copied={copiedText(d.copied_at) ?? undefined}
        onApprove={() => onApprove(d.task_id, d.key)}
        onAnswer={() => onOpenBox(d.task_id, d.key, "answer")}
        onDeny={() => onOpenBox(d.task_id, d.key, "deny")}
      />
    </li>
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
