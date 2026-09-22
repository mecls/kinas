import type { ReaderView, UsageSnapshot } from "../api.ts";
import type { ConnectionState } from "../ui/Nav.tsx";

// The VPS row at the foot of the sidebar (DESIGN.md §3.1): one machine, one word. The word is the Hostinger
// reader's state as the usage snapshot reports it — the same reading the Usage page shows, so the two never
// disagree. Nothing configured, nothing shown: a row that says "not configured" is a settings page, not a status.

export interface Connection {
  name: string;
  state: ConnectionState;
  /** What the hover says: when the reading was taken, or the error in the reader's words. */
  detail: string;
}

export const VPS_NAME = "Hostinger VPS";

/** `null` while no machine is watched. Stale past the reader's own `stale_after_ms`, like every gauge. */
export function connectionOf(snapshot: Pick<UsageSnapshot, "now" | "readers">): Connection | null {
  const reader = snapshot.readers.find((r): r is ReaderView => r.reader === "hostinger");
  if (!reader || reader.state === "not_configured") return null;
  if (reader.state === "error") return { name: VPS_NAME, state: "error", detail: reader.last_error ?? "the last reading failed" };
  const since = reader.last_success_at;
  if (since === null || snapshot.now - since > reader.stale_after_ms) {
    return { name: VPS_NAME, state: "stale", detail: since === null ? "no reading yet" : `as of ${clock(since)}` };
  }
  return { name: VPS_NAME, state: "connected", detail: `as of ${clock(since)}` };
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
