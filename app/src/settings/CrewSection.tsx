import { useCallback, useEffect, useState } from "react";
import { getCrewSettings, type CrewSettings, type FirstmateOptions, type LaneOption, type PinState } from "../api.ts";
import { clock } from "../crew/detail.ts";
import { ToolTable } from "../crew/ToolTable.tsx";
import { Card, Dot, Table } from "../ui/index.ts";

// Settings → Crew (build spec §4 Settings; mockup settings-crew.html): Firstmate's install as the app last probed it —
// the commit against the pin, the home, the backend, the prerequisites, the away record, the tools and the projects'
// modes. Everything here is read; changing any of it is asked of the first mate in its pane, or of kinas crew setup.
// Self-contained like ConvexSection; read again whenever Settings comes on screen.

/** Firstmate's ISO 8601 stamp on the crew's one clock (crew/detail.ts); one that does not parse is shown as written. */
const isoClock = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : clock(at);
};

function PinLine({ pin }: { pin: PinState }) {
  switch (pin.state) {
    case "pinned":
      return (
        <>
          <span className="crew-mono">{pin.short}</span> (pinned)
        </>
      );
    case "moved":
      return (
        <span className="crew-problem-inline">
          <span className="crew-mono">{pin.short}</span> — moved from {pin.from} (/updatefirstmate); Kinas reads it at its snapshot contract
        </span>
      );
    case "tangle":
      return <span className="crew-problem-inline">on branch {pin.branch} — a tangle; ask the first mate</span>;
    case "missing":
      return <span className="crew-problem-inline">not a clone — run kinas crew setup in the Work pane</span>;
  }
}

/** An option's state in the status badge's pill and words (DESIGN.md 1.12): the tool table's way, its own words. */
function OptionBadge({ word, color }: { word: string; color: string }) {
  return (
    <span className="ui-badge" data-option={word}>
      <Dot color={color} />
      {word}
    </span>
  );
}

const onOff = (on: boolean) => (on ? <OptionBadge word="on" color="--ok" /> : <OptionBadge word="off" color="--stale" />);

function laneBadge(lane: LaneOption) {
  switch (lane.state) {
    case "off":
      return <OptionBadge word="off" color="--stale" />;
    case "cap":
      return <OptionBadge word={`cap ${lane.cap}`} color="--ok" />;
    case "auto":
      return <OptionBadge word="auto" color="--ok" />;
    case "checks-quota":
      return <OptionBadge word="checks quota — Kinas does not run it" color="--warn" />;
    case "invalid":
      return <OptionBadge word="invalid" color="--danger" />;
  }
}

const OPTION_COLUMNS = [
  { key: "option", label: "Option" },
  { key: "state", label: "State" },
];

/** Firstmate options (Firstmate, current; PRD rule 5): which of the three are on. Kinas writes none of them. */
function OptionsTable({ options }: { options: FirstmateOptions }) {
  const rows = [
    { option: "Park on review", state: onOff(options.park_on_review), name: "park-on-review" },
    { option: "Fleet ledger", state: onOff(options.fleet_ledger), name: "fleet-ledger" },
    { option: "Lane capacity", state: laneBadge(options.lane_capacity), name: "lane-capacity" },
  ];
  return (
    <>
      <Table
        className="crew-options"
        caption="Firstmate options"
        columns={OPTION_COLUMNS}
        rows={rows}
        rowKey={(r) => String(r.name)}
        rowProps={(r) => ({ "data-option-row": String(r.name) })}
      />
      <p className="settings-help" data-testid="crew-options-help">Turn these on or off by asking the first mate.</p>
    </>
  );
}

export function CrewSection({ active }: { active: boolean }) {
  const [settings, setSettings] = useState<CrewSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      void getCrewSettings().then(
        (s) => {
          setSettings(s);
          setError(null);
        },
        (e: unknown) => setError((e as { message?: string }).message ?? String(e)),
      ),
    [],
  );

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const missingPrereqs = settings?.prereqs.filter((p) => p.state !== "installed").map((p) => p.name) ?? [];

  return (
    <Card className="settings-section" data-section="crew">
      <h2>Firstmate</h2>
      {error && <p className="crew-problem">Could not read Firstmate's config: {error}</p>}
      {!settings ? (
        !error && <p className="settings-help">Reading Firstmate's install…</p>
      ) : !settings.installed ? (
        <>
          <p className="settings-help" data-testid="crew-not-installed">
            Not installed — run <code>kinas crew setup</code> in the Work pane
          </p>
          <ToolTable settings={settings} />
        </>
      ) : (
        <>
          <dl className="crew-kv">
            <dt>Commit</dt>
            <dd data-testid="crew-pin">
              <PinLine pin={settings.pin} />
            </dd>
            <dt>Home</dt>
            <dd className="crew-mono">{settings.home_display}</dd>
            <dt>Backend</dt>
            <dd data-testid="crew-backend">
              {settings.backend === "herdr" ? "herdr" : <span className="crew-problem-inline">{settings.backend ?? "none"} — Kinas expects herdr</span>}
            </dd>
            <dt>Prerequisites</dt>
            <dd>
              {missingPrereqs.length === 0 ? (
                `${settings.prereqs.map((p) => p.name).join(", ")} — all found`
              ) : (
                <span className="crew-problem-inline">missing: {missingPrereqs.join(", ")}</span>
              )}
            </dd>
            {settings.away && (
              <>
                <dt>Away</dt>
                <dd>
                  since {isoClock(settings.away.entered)}
                  {settings.away.expected_return && ` · back ${isoClock(settings.away.expected_return)}`}
                </dd>
              </>
            )}
          </dl>
          <ToolTable settings={settings} />
          {settings.options && <OptionsTable options={settings.options} />}
          <h3 className="crew-subhead">Projects</h3>
          {settings.projects.length === 0 ? (
            <p className="settings-help">No projects registered — ask the first mate</p>
          ) : (
            <ul className="crew-projects">
              {settings.projects.map((p) => (
                <li key={p.name}>
                  <span className="crew-mono">{p.name}</span> · {p.mode} · yolo {p.yolo ? "on" : "off"}
                </li>
              ))}
            </ul>
          )}
          <p className="settings-help crew-after">Modes, the project list and away mode are the first mate's: ask in its pane.</p>
        </>
      )}
    </Card>
  );
}
