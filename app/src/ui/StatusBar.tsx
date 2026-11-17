import { forwardRef } from "react";
import { Dot } from "./Dot.tsx";
import { ServerIcon } from "./icons.tsx";
import "./StatusBar.css";

// DESIGN.md §4 Status bar (1.13, the interface polish): the window's foot, one row across the whole window below the
// three columns (§3.1). Presentation only — App works out what it says (shell/statusBar.ts). Like the title bar it is a
// static part of the window, never conditional, so nothing above the terminal moves (ADR 0002). Each part is a button
// reachable by Tab: the readings open the Usage popover, the counts the Crew page, the VPS the Usage page at its
// section; with nothing configured the left is one button to Settings → Providers.

/** One reading: "Claude session" and "97%", and the tone's dot only when warn, danger or stale. */
export interface StatusReading {
  key: string;
  label: string;
  pct: string;
  tone?: "warn" | "danger" | "stale" | null;
}

export interface StatusCrewPart {
  key: string;
  text: string;
  /** The dot's colour token: --warn for what needs the captain, --danger for what failed, --meter for what works. */
  color: string;
}

export interface StatusVps {
  name: string;
  state: "connected" | "stale" | "error";
  detail: string;
}

const TONE_COLOR = { warn: "--warn", danger: "--danger", stale: "--stale" } as const;
const VPS_COLOR = { connected: "--ok", stale: "--stale", error: "--danger" } as const;

export const StatusBar = forwardRef<
  HTMLButtonElement,
  {
    readings: readonly StatusReading[];
    /** No quota at all: "No usage readings — Settings → Providers". */
    empty?: boolean;
    crew?: readonly StatusCrewPart[] | null;
    vps?: StatusVps | null;
    /** The popover is open: the readings button says so. */
    open?: boolean;
    onReadings?: () => void;
    onCrew?: () => void;
    onVps?: () => void;
    onSettings?: () => void;
  }
>(function StatusBar({ readings, empty = false, crew = null, vps = null, open = false, onReadings, onCrew, onVps, onSettings }, readingsRef) {
  return (
    <footer className="ui-statusbar" aria-label="Status">
      {empty ? (
        <button type="button" className="ui-statusbar-part" data-part="empty" onClick={onSettings}>
          No usage readings — Settings → Providers
        </button>
      ) : (
        readings.length > 0 && (
          <button ref={readingsRef} type="button" className="ui-statusbar-part" data-part="readings" aria-haspopup="dialog" aria-expanded={open} title="Usage" onClick={onReadings}>
            {readings.map((r) => (
              <span key={r.key} className="ui-statusbar-reading" data-reading={r.key} data-tone={r.tone ?? undefined}>
                {r.tone && <Dot color={TONE_COLOR[r.tone]} />}
                {r.label} <span className="ui-statusbar-num">{r.pct}</span>
              </span>
            ))}
          </button>
        )
      )}
      <span className="ui-statusbar-gap" />
      {crew && crew.length > 0 && (
        <button type="button" className="ui-statusbar-part" data-part="crew" title="The Crew page" onClick={onCrew}>
          {crew.map((c, i) => (
            <span key={c.key} className="ui-statusbar-count" data-count={c.key}>
              {i > 0 && <span className="ui-statusbar-sep">·</span>}
              <Dot color={c.color} />
              {c.text}
            </span>
          ))}
        </button>
      )}
      {vps && (
        <button type="button" className="ui-statusbar-part" data-part="vps" data-state={vps.state} title={vps.detail} onClick={onVps}>
          <ServerIcon size="sm" />
          {vps.name}
          <Dot color={VPS_COLOR[vps.state]} />
          {vps.state}
        </button>
      )}
    </footer>
  );
});
