import { useEffect, useMemo, useState } from "react";
import { getPlaceStatus, onCrewChanged, type PlaceStatus } from "../api.ts";
import { latestOnly } from "./latest.ts";
import { machineOf, type Machine } from "./connection.ts";

// The agents' machine for the status bar (DESIGN.md 1.14): read from Kinas's own store — never a call to the VPS — on
// start, after every crew reading (`crew_changed`), when the window comes forward, and every 15 s so "reconnecting"
// turns "unreachable" and a stopped loop is noticed without a new reading. Null while the agents run on this Mac.

const RECHECK_MS = 15_000;

export function useMachine(): Machine | null {
  const [status, setStatus] = useState<PlaceStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reload = useMemo(
    () =>
      latestOnly(
        getPlaceStatus,
        (s) => {
          setStatus(s);
          setNow(Date.now());
        },
        // A store that cannot be read keeps the last word: the bar is not where that failure is told.
        () => {},
      ),
    [],
  );
  useEffect(() => {
    reload();
    const unlisten = onCrewChanged(reload);
    window.addEventListener("focus", reload);
    const timer = window.setInterval(reload, RECHECK_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
      void unlisten.then((stop) => stop());
    };
  }, [reload]);
  return useMemo(() => machineOf(status, now), [status, now]);
}
