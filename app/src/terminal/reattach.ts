// The Work page attached to a VPS (build spec §11.2, slice 3.1): what the pane reports to its chrome, and how long it
// waits before attaching again after Herdr's remote client exits.

/** `connecting` from a start until the pane first draws; `attached` once it has; `detached` once it exits or fails. */
export type Attach = "connecting" | "attached" | "detached";

/** The waits, in order: an attach that ends within 30 s of starting moves one step along; one that lasted resets it. */
export const REATTACH_MS = [2_000, 5_000, 10_000, 30_000] as const;

/** The wait before the next attach, after `quickExits` attaches in a row that each ended within 30 s. */
export function reattachDelay(quickExits: number): number {
  const step = Math.min(Math.max(quickExits - 1, 0), REATTACH_MS.length - 1);
  return REATTACH_MS[step]!;
}
