import { useCallback, useEffect, useState } from "react";
import { getCrewSettings, type CrewSettings, type PinState } from "../api.ts";
import { ToolTable } from "../crew/ToolTable.tsx";
import { Card } from "../ui/index.ts";

// Settings → Crew (build spec §4 Settings; mockup settings-crew.html): Firstmate's install as the app last probed it —
// the commit against the pin, the home, the backend, the prerequisites, the away record, the tools and the projects'
// modes. Everything here is read; changing any of it is asked of the first mate in its pane, or of kinas crew setup.
// Self-contained like ConvexSection; read again whenever Settings comes on screen.

const clock = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
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
                  since {clock(settings.away.entered)}
                  {settings.away.expected_return && ` · back ${clock(settings.away.expected_return)}`}
                </dd>
              </>
            )}
          </dl>
          <ToolTable settings={settings} />
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
