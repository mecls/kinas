// The factory's events the companion may send (build spec §7, §11.2): a record of what happened, kept forever, so a bad one
// is refused before it is stored. Pure, so it is tested and the mutation only calls it.

export const EVENT_NAMES = ["dispatched", "pr_ready", "merged", "cleaned_up", "held", "answered", "hold_closed", "red", "tokens"] as const;
/** One call carries at most this many; the companion sends a longer backlog in batches. */
export const MAX_EVENTS = 200;
const MAX_TASK = 128;
const MAX_PROJECT = 100;
/** 1 Jan 2020 in milliseconds: no event is older. */
const EARLIEST = 1_577_836_800_000;
const MAX_VALUE = 10 ** 12;

export interface EventIn {
  task: string;
  project: string;
  event: string;
  at: number;
  value?: number | null;
}

/** Why a list of events must be refused, or null when every one is well formed. */
export function eventsViolation(events: EventIn[], now = Date.now()): string | null {
  if (events.length > MAX_EVENTS) return `too many events (${events.length})`;
  for (const e of events) {
    if (e.task.length < 1 || e.task.length > MAX_TASK) return "task is empty or too long";
    if (e.project.length < 1 || e.project.length > MAX_PROJECT) return "project is empty or too long";
    if (!(EVENT_NAMES as readonly string[]).includes(e.event)) return "event is not one the factory records";
    if (!Number.isSafeInteger(e.at) || e.at < EARLIEST || e.at > now + 86_400_000) return "at is not a time";
    const hasValue = e.value !== undefined && e.value !== null;
    if (e.event === "tokens") {
      if (!hasValue || !Number.isSafeInteger(e.value) || (e.value as number) < 0 || (e.value as number) > MAX_VALUE) return "value is not a token count";
    } else if (hasValue) return "value belongs to tokens only";
  }
  return null;
}
