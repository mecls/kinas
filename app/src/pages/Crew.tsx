import { useEffect, useState } from "react";
import { getCrewSettings, type CrewSettings, type CrewSnapshot } from "../api.ts";
import { fleetAsOf } from "../crew/board.ts";
import { Board } from "../crew/Board.tsx";
import { ToolTable } from "../crew/ToolTable.tsx";
import type { SeatedFolder } from "../shell/folders.ts";
import { writeClipboard } from "../terminal/clipboard.ts";
import { Button, EmptyState, Section, SectionHeader, TitleRow } from "../ui/index.ts";

// Crew (build spec §4; DESIGN.md §5; mockup board.html): the first mate's fleet as Kinas mirrors it, one card per task
// Firstmate knows. Three states: not installed (how to set up, and the tools), installed (Start the first mate now?, the
// pin, the tools — and the fleet below when there is one, since workers outlive a stopped first mate), and running.
// The board (crew/Board.tsx) has a lane per client folder matched by GitHub repository; a card opens its detail in the
// right panel, and Open its pane focuses its worker.

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

export function CrewPage({
  crew,
  active,
  folders = [],
  selected = null,
  onSelect = () => {},
  onOpenPane = () => {},
  onLaunch,
  onInbox = () => {},
}: {
  crew: CrewSnapshot | null;
  active: boolean;
  folders?: readonly SeatedFolder[];
  /** The task whose detail the panel shows. */
  selected?: string | null;
  onSelect?: (id: string) => void;
  onOpenPane?: (id: string) => void;
  onLaunch?: () => void;
  onInbox?: () => void;
}) {
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
        {!!crew?.waiting && (
          <Button data-testid="crew-waiting" onClick={onInbox}>
            {crew.waiting} waiting on you
          </Button>
        )}
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
          <SectionHeader title="Fleet" caption={fleetAsOf(crew.generated, crew.now) ?? undefined} source="Firstmate's fleet snapshot" />
          {crew.reader.state === "error" && crew.reader.last_error && (
            <p className="crew-error" data-testid="crew-error">
              Crew: {crew.reader.last_error} · showing the last reading
            </p>
          )}
          {crew.tasks.length === 0 ? (
            <EmptyState>No tasks — ask in the first mate's pane</EmptyState>
          ) : (
            <Board tasks={crew.tasks} folders={folders} now={crew.now} selected={selected} onSelect={onSelect} onOpenPane={onOpenPane} />
          )}
        </Section>
      )}
    </div>
  );
}
