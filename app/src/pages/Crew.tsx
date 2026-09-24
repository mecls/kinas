import type { CrewSnapshot, CrewTask, CrewWord } from "../api.ts";
import { Card, EmptyState, Lane, Section, SectionHeader, StatusBadge, TitleRow, type BadgeState } from "../ui/index.ts";

// Crew (build spec §4; DESIGN.md §5; mockup board.html): the first mate's fleet as Kinas mirrors it, one card per task
// Firstmate knows. This is the tracer bullet's board (slice 1): one lane per project, a card's title and its word. The
// board by repository, the PR line and the task detail arrive with slice 4, the launcher with slice 3.

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

export function CrewPage({ crew }: { crew: CrewSnapshot | null }) {
  return (
    <div className="page-in crew" data-crew={crew?.page}>
      <TitleRow title="Crew" />
      {crew?.page === "uninstalled" && <EmptyState>Set up the crew — run this in the Work pane: kinas crew setup</EmptyState>}
      {crew && crew.page !== "uninstalled" && (
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
