import type { ReaderView, UsageSnapshot } from "../api.ts";
import { failedRead } from "../pages/readFailure.ts";
import type { ConnectionState } from "../ui/Nav.tsx";
import { asOf } from "../usage/format.ts";

// The VPS row at the foot of the sidebar (DESIGN.md §3.1): one machine, one word. The word is the Hostinger
// reader's state as the usage snapshot reports it — the same reading the Usage page shows, so the two never
// disagree. Nothing configured, nothing shown: a row that says "not configured" is a settings page, not a status.
// The hover's "as of" is the Usage page's own caption (usage/format.ts): 24-hour, Europe/Lisbon, not the webview's
// locale — the same reading must read the same time wherever it is said.

export interface Connection {
  name: string;
  state: ConnectionState;
  /** What the hover says: when the reading was taken, or the error in the reader's words. */
  detail: string;
}

export const VPS_NAME = "Hostinger VPS";

/**
 * `null` while no machine is watched. Stale past the reader's own `stale_after_ms`, like every gauge — and stamped in
 * what is now the future, from before a backwards clock step, whose age is unknown (`packages/store/src/staleness.ts`).
 *
 * `readError`: the snapshot itself could not be read again (usage/useUsageSnapshot.ts), so this is the last good one
 * and its `now` has stopped: "connected" can no longer be judged, and is stale for the same reason a stamp from the
 * future is; every word keeps the read failure in its hover, as the Usage page says it (ADR 0004).
 */
export function connectionOf(snapshot: Pick<UsageSnapshot, "now" | "readers">, readError: string | null = null): Connection | null {
  const row = judged(snapshot);
  const failed = failedRead("usage", readError, true);
  if (!row || !failed) return row;
  return { ...row, state: row.state === "connected" ? "stale" : row.state, detail: `${row.detail} · ${failed}` };
}

function judged(snapshot: Pick<UsageSnapshot, "now" | "readers">): Connection | null {
  const reader = snapshot.readers.find((r): r is ReaderView => r.reader === "hostinger");
  if (!reader || reader.state === "not_configured") return null;
  if (reader.state === "error") return { name: VPS_NAME, state: "error", detail: reader.last_error ?? "the last reading failed" };
  const since = reader.last_success_at;
  if (since === null || since > snapshot.now || snapshot.now - since > reader.stale_after_ms) {
    return { name: VPS_NAME, state: "stale", detail: since === null ? "no reading yet" : asOf(since, snapshot.now) };
  }
  return { name: VPS_NAME, state: "connected", detail: asOf(since, snapshot.now) };
}
