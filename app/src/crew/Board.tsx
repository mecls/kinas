import type { KeyboardEvent } from "react";
import type { CrewTask } from "../api.ts";
import type { SeatedFolder } from "../shell/folders.ts";
import { Button, Card, Lane, StatusBadge } from "../ui/index.ts";
import { BADGE_OF, lanesOf, metaLine, prLine } from "./board.ts";

// The Crew board (build spec §4 Crew page; mockup board.html): composition only. The rules are board.ts's; the lanes,
// cards and badges are the library's; crew.css says where they sit.

function TaskCard({
  task,
  now,
  selected,
  onSelect,
  onOpenPane,
}: {
  task: CrewTask;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpenPane: (id: string) => void;
}) {
  const title = task.title ?? task.id;
  const pr = prLine(task.pr);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onSelect(task.id);
  };
  return (
    <Card
      className="crew-card"
      data-task={task.id}
      data-word={task.word}
      title={title}
      selected={selected}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      onClick={() => onSelect(task.id)}
      onKeyDown={onKeyDown}
    >
      <div className="crew-row">
        <StatusBadge state={BADGE_OF[task.word]} />
        <span className="crew-meta">{metaLine(task, now)}</span>
      </div>
      {pr && <div className="crew-pr">{pr}</div>}
      {task.has_pane && (
        <div className="crew-row">
          <Button
            kind="text"
            aria-label={`Open ${title}'s pane`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPane(task.id);
            }}
          >
            Open its pane
          </Button>
        </div>
      )}
    </Card>
  );
}

export function Board({
  tasks,
  folders,
  now,
  selected,
  onSelect,
  onOpenPane,
}: {
  tasks: readonly CrewTask[];
  folders: readonly SeatedFolder[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenPane: (id: string) => void;
}) {
  return (
    <div className="crew-board">
      {lanesOf(tasks, folders).map((lane) => (
        <Lane
          key={lane.key}
          className="crew-lane"
          name={lane.name}
          cat={lane.cat ?? undefined}
          internal={lane.internal}
          counts={lane.counts || undefined}
          data-repo={lane.repo ?? undefined}
          data-project={lane.repo ? undefined : lane.name}
        >
          {lane.tasks.map((t) => (
            <TaskCard key={t.id} task={t} now={now} selected={t.id === selected} onSelect={onSelect} onOpenPane={onOpenPane} />
          ))}
        </Lane>
      ))}
    </div>
  );
}
