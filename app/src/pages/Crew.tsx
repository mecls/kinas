import { useEffect, useState } from "react";
import { getCrewSettings, type CrewSettings, type CrewSnapshot, type CrewTask, type CrewWord } from "../api.ts";
import { ToolTable } from "../crew/ToolTable.tsx";
import { writeClipboard } from "../terminal/clipboard.ts";
import { Button, Card, EmptyState, Lane, Section, SectionHeader, StatusBadge, TitleRow, type BadgeState } from "../ui/index.ts";

// Crew (build spec §4; DESIGN.md §5; mockup board.html): the first mate's fleet as Kinas mirrors it, one card per task
// Firstmate knows. Three states: not installed (how to set up, and the tools), installed (Start the first mate now?, the
// pin, the tools — and the fleet below when there is one, since workers outlive a stopped first mate), and running.
// The board is slice 1's (one lane per project, a card's title and its word); lanes by repository, the PR line and the
// task detail arrive with slice 4, the launcher and the running state with slice 3.

/** The badge for each word that has one; the four DESIGN.md 1.4 adds (failed, paused, unknown, gone) come with slice 4. */
const BADGE_OF: Partial<Record<CrewWord, BadgeState>> = {
  queued: "queued",
  working: "working",
  "needs decision": "decision",
  blocked: "blocked",
  "CI red": "red",
  "PR open": "pr",
  ready: "ready",
  done: "done",
};

/** The caption's clock: the snapshot's own time, as a 24-hour local time. */
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

/** "as of 09:31:12", or "stale · as of 09:31:12" once the snapshot is more than 60 s old (§4). */
export function asOf(generated: string | null, now: number): string | null {
  const at = generated ? Date.parse(generated) : NaN;
  if (Number.isNaN(at)) return null;
  return `${now - at > 60_000 ? "stale · " : ""}as of ${clock(at)}`;
}

/** One lane per project name, in the order the projects first appear; a task with no project goes under "Other". */
export function lanesByProject(tasks: readonly CrewTask[]): { name: string; tasks: CrewTask[] }[] {
  const lanes = new Map<string, CrewTask[]>();
  for (const t of tasks) {
    const name = t.project_name ?? "Other";
    lanes.set(name, [...(lanes.get(name) ?? []), t]);
  }
  return [...lanes].map(([name, list]) => ({ name, tasks: list }));
}

function TaskCard({ task }: { task: CrewTask }) {
  const badge = BADGE_OF[task.word];
  return (
    <Card className="crew-card" data-task={task.id} data-word={task.word} title={task.title ?? task.id}>
      {badge ? <StatusBadge state={badge} /> : <span className="crew-word">{task.word}</span>}
    </Card>
  );
}

/** Before the first launch: the question, the pin, the tools, and what blocks the launch (§4 Crew page, Installed). */
function StartFirstMate({ settings, blocked }: { settings: CrewSettings; blocked: string | null }) {
  const pin = settings.pin.state === "pinned" || settings.pin.state === "moved" ? settings.pin.short : null;
  return (
    <div className="crew-start" data-testid="crew-start">
      <p className="crew-start-q">Start the first mate now?</p>
      <dl className="crew-kv">
        <dt>Firstmate</dt>
        <dd>{pin ? <><span className="crew-mono">{pin}</span>{settings.pin.state === "pinned" ? " (pinned)" : " (moved from the pin)"}</> : "not a clone"}</dd>
      </dl>
      <ToolTable settings={settings} />
      {blocked && <p className="crew-blocked">{blocked}</p>}
    </div>
  );
}

export function CrewPage({ crew, active, onLaunch }: { crew: CrewSnapshot | null; active: boolean; onLaunch?: () => void }) {
  const [settings, setSettings] = useState<CrewSettings | null>(null);
  const [copied, setCopied] = useState(false);
  const page = crew?.page;
  // The tools are read when the page shows before the first mate runs; the snapshot carries only what blocks Launch.
  useEffect(() => {
    if (!active || (page !== "uninstalled" && page !== "installed")) return;
    void getCrewSettings().then(setSettings, () => {});
  }, [active, page]);
  const blocked = settings?.blocked ?? crew?.blocked ?? null;
  return (
    <div className="page-in crew" data-crew={page}>
      <TitleRow title="Crew">
        {page === "running" && (
          <Button kind="primary" onClick={() => onLaunch?.()}>
            First mate
          </Button>
        )}
        {page === "installed" && (
          <Button
            kind="primary"
            aria-disabled={blocked ? "true" : undefined}
            title={blocked ?? undefined}
            onClick={() => {
              if (!blocked) onLaunch?.();
            }}
          >
            Launch the first mate
          </Button>
        )}
      </TitleRow>
      {page === "uninstalled" && (
        <>
          <EmptyState
            data-testid="crew-setup"
            action={{
              label: copied ? "Copied" : "Copy",
              onClick: () =>
                void writeClipboard("kinas crew setup").then((ok) => {
                  setCopied(ok);
                  if (ok) window.setTimeout(() => setCopied(false), 1500);
                }),
            }}
          >
            Set up the crew — run this in the Work pane: <span className="crew-mono">kinas crew setup</span>
          </EmptyState>
          {settings && <ToolTable settings={settings} />}
        </>
      )}
      {page === "installed" && settings && <StartFirstMate settings={settings} blocked={blocked} />}
      {crew && page !== "uninstalled" && (page === "running" || crew.tasks.length > 0 || crew.reader.state === "error") && (
        <Section>
          <SectionHeader title="Fleet" caption={asOf(crew.generated, crew.now) ?? undefined} source="Firstmate's fleet snapshot" />
          {crew.reader.state === "error" && crew.reader.last_error && (
            <p className="crew-error" data-testid="crew-error">
              Crew: {crew.reader.last_error} · showing the last reading
            </p>
          )}
          {crew.tasks.length === 0 ? (
            <EmptyState>No tasks — ask in the first mate's pane</EmptyState>
          ) : (
            <div className="crew-board">
              {lanesByProject(crew.tasks).map((lane) => (
                <Lane key={lane.name} className="crew-lane" name={lane.name} data-project={lane.name}>
                  {lane.tasks.map((t) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                </Lane>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
