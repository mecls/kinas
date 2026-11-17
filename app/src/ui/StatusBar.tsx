import "./StatusBar.css";

// DESIGN.md §4 Status bar (1.13, the interface polish): the window's foot, one row across the whole window below the
// three columns (§3.1). Presentation only — App works out what it says. Like the title bar it is a static part of the
// window, never conditional, so nothing above the terminal moves (ADR 0002).
//
// Slice 1, the tracer bullet: the readings of Home's three gauges as plain text, so the row stands with something
// true in it. Slice 6 brings the tones, the crew's counts, the VPS and the Usage popover (build-spec §11.2).

/** One reading: "Claude session" and "97%". */
export interface StatusReading {
  key: string;
  label: string;
  pct: string;
}

export function StatusBar({ readings }: { readings: readonly StatusReading[] }) {
  return (
    <footer className="ui-statusbar" aria-label="Status">
      {readings.map((r) => (
        <span key={r.key} className="ui-statusbar-reading" data-reading={r.key}>
          {r.label} <span className="ui-statusbar-num">{r.pct}</span>
        </span>
      ))}
    </footer>
  );
}
