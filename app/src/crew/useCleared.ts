import { useCallback, useEffect, useRef } from "react";
import { crewSeen, type CrewSurface, type CrewTask } from "../api.ts";
import { onScreen, toStamp } from "./board.ts";

// A page's load (done work clears, `tasks/crew-done-clears/prd.md` rules 3–6). The pages never unmount — App hides
// them — so a load is the page coming on screen: `active` false → true, which a window reload or Kinas starting on the
// page also is. From then until the next load the page draws every task but the finished ones it had stamped before,
// never takes away one it has drawn, and asks Rust to stamp the finished ones it draws while the window is visible.

/**
 * Debug builds only (testHooks.ts): the e2e window sits off screen, where WebKit calls it hidden, so a spec says to count
 * it shown. Vite replaces the condition with `false` in a release build, and the hook is never there.
 */
let assumeShown = false;
if (import.meta.env.TAURI_ENV_DEBUG === "true") {
  void import("../testHooks.ts").then(({ registerTestHooks }) =>
    registerTestHooks({
      crewAssumeShown: () => {
        assumeShown = true;
        return true;
      },
    }),
  );
}
/** Seen means seen: a window behind others, or minimised, shows the captain nothing. */
const windowShown = () => document.visibilityState === "visible" || assumeShown;

interface Load {
  openedAt: number;
  /** Every task drawn in this load: never taken away before the next one (rule 3). */
  keep: Set<string>;
  /** The ids already sent to be stamped in this load, so a re-read does not ask again. */
  asked: Set<string>;
}

export function useCleared(
  surface: CrewSurface,
  active: boolean,
  reload: () => void,
): { onScreen: (tasks: readonly CrewTask[]) => CrewTask[]; shown: (drawn: readonly CrewTask[]) => void } {
  const load = useRef<Load | null>(null);
  const wasActive = useRef(false);
  const isActive = useRef(active);
  // The stamps this page asked for, kept across its loads: a reading taken before Rust wrote them still says none, and
  // a quick return would show the card again. A task drawn unfinished again forgets its own (rule 7).
  const stampedHere = useRef(new Map<string, number>());
  // Opened in the render that shows the page, not in an effect: an effect would let that first render draw with the
  // last load's moment, and keep what this one must clear.
  if (active && !wasActive.current) load.current = { openedAt: Date.now(), keep: new Set(), asked: new Set() };
  wasActive.current = active;
  isActive.current = active;

  // A fresh reading for the new load; the page draws the last one meanwhile, filtered by this load.
  useEffect(() => {
    if (active) reload();
  }, [active, reload]);

  const filter = useCallback(
    (tasks: readonly CrewTask[]) => {
      const now = load.current;
      return now ? onScreen(tasks, surface, now.openedAt, now.keep, stampedHere.current) : [...tasks];
    },
    [surface],
  );

  const shown = useCallback(
    (drawn: readonly CrewTask[]) => {
      const now = load.current;
      if (!now || !isActive.current) return;
      for (const t of drawn) {
        now.keep.add(t.id);
        if (!t.finished) stampedHere.current.delete(t.id);
      }
      if (!windowShown()) return;
      const ids = toStamp(drawn, surface).filter((id) => !now.asked.has(id) && !stampedHere.current.has(id));
      if (ids.length === 0) return;
      const at = Date.now();
      for (const id of ids) {
        now.asked.add(id);
        stampedHere.current.set(id, at);
      }
      // A stamp that cannot be written is dropped: the task keeps no stamp, so it is shown again at the next load
      // and never cleared unseen (Journey D). A later re-read of this load may ask again.
      void crewSeen(surface, ids).catch(() => {
        for (const id of ids) {
          now.asked.delete(id);
          stampedHere.current.delete(id);
        }
      });
    },
    [surface],
  );

  return { onScreen: filter, shown };
}
