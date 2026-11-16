import type { CrewLanes } from "../api.ts";
import { clock } from "./detail.ts";

// Free lanes (Firstmate, current; DESIGN.md 1.12): the Fleet caption's words for Firstmate's last lane reading. Its own
// module so it can share the crew's one clock (crew/detail.ts) without a cycle through board.ts.

/** A lane reading is stale past 120 s, or stamped in what is now the future (the clock stepped back). */
const LANES_FRESH_MS = 120_000;

/**
 * Free lanes in the Fleet caption (DESIGN.md 1.12): "2 of 4 lanes free", "3 lanes free · auto", or "lanes as of 09:31"
 * once the reading is stale; and "dispatch held · <reasons>" while Firstmate holds dispatch, in its own words. Nulls
 * when there is nothing to say — no lane cap, or no number.
 */
export function lanesCaption(l: CrewLanes | null, now: number): { count: string | null; held: string | null } {
  if (!l) return { count: null, held: null };
  if (l.at > now || now - l.at > LANES_FRESH_MS) return { count: `lanes as of ${clock(l.at)}`, held: null };
  const count =
    l.free === null ? null : l.auto ? `${l.free} ${l.free === 1 ? "lane" : "lanes"} free · auto` : l.cap !== null ? `${l.free} of ${l.cap} lanes free` : null;
  const held = l.held ? (l.reasons.length > 0 ? `dispatch held · ${l.reasons.join(", ")}` : "dispatch held") : null;
  return { count, held };
}
