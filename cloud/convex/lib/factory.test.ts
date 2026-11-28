import { expect, test } from "bun:test";
import { EVENT_NAMES, MAX_EVENTS, eventsViolation } from "./factory.ts";

const good = { task: "t1", project: "alpha", event: "merged", at: 1_795_000_000_000 };

test("a list of well-formed events is accepted, and an empty list too", () => {
  expect(eventsViolation([good, { ...good, event: "tokens", value: 150 }])).toBeNull();
  expect(eventsViolation([])).toBeNull();
});

test("every event name the factory records is accepted, and any other is refused", () => {
  for (const event of EVENT_NAMES) expect(eventsViolation([{ ...good, event, ...(event === "tokens" ? { value: 1 } : {}) }]), event).toBeNull();
  expect(eventsViolation([{ ...good, event: "deleted" }])).toBe("event is not one the factory records");
});

test("a batch is at most 200 events", () => {
  expect(eventsViolation(Array.from({ length: MAX_EVENTS }, (_, i) => ({ ...good, at: good.at + i })))).toBeNull();
  expect(eventsViolation(Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ ...good, at: good.at + i })))).toBe("too many events (201)");
});

test("a task over 128 characters, a project over 100, or an empty one is refused", () => {
  expect(eventsViolation([{ ...good, task: "t".repeat(129) }])).toBe("task is empty or too long");
  expect(eventsViolation([{ ...good, task: "" }])).toBe("task is empty or too long");
  expect(eventsViolation([{ ...good, project: "p".repeat(101) }])).toBe("project is empty or too long");
  expect(eventsViolation([{ ...good, project: "" }])).toBe("project is empty or too long");
});

test("a time is a whole number of milliseconds after 2020 and not in the far future", () => {
  expect(eventsViolation([{ ...good, at: 1.5 }])).toBe("at is not a time");
  expect(eventsViolation([{ ...good, at: good.at + 0.5 }])).toBe("at is not a time");
  expect(eventsViolation([{ ...good, at: -1 }])).toBe("at is not a time");
  expect(eventsViolation([{ ...good, at: 1_000 }])).toBe("at is not a time");
  expect(eventsViolation([{ ...good, at: Number.NaN }])).toBe("at is not a time");
  expect(eventsViolation([{ ...good, at: Date.now() + 3 * 86_400_000 }], Date.now())).toBe("at is not a time");
});

test("only tokens carry a value, a whole non-negative number", () => {
  expect(eventsViolation([{ ...good, value: 5 }])).toBe("value belongs to tokens only");
  expect(eventsViolation([{ ...good, event: "tokens" }])).toBe("value is not a token count");
  expect(eventsViolation([{ ...good, event: "tokens", value: -1 }])).toBe("value is not a token count");
  expect(eventsViolation([{ ...good, event: "tokens", value: 1.5 }])).toBe("value is not a token count");
  expect(eventsViolation([{ ...good, event: "tokens", value: 10 ** 13 }])).toBe("value is not a token count");
});
