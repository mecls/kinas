import { expect, test } from "bun:test";
import { failedRead } from "./readFailure.ts";

// A read that fails after a good one keeps the good one (ADR 0004) and says so beside it, in the words the pages
// already use for a reader's own failure: "<what>: <why> · showing the last reading".

test("the usage snapshot: the reason, and that the numbers on screen are the last ones read", () => {
  expect(failedRead("usage", "database is locked", true)).toBe("Could not read the readings: database is locked · showing the last reading");
});

test("the crew's reading, as the Crew and Inbox pages say the collector's own failure", () => {
  expect(failedRead("crew", "could not read the crew: database is locked", true)).toBe("Crew: could not read the crew: database is locked · showing the last reading");
});

test("Settings, read again each time it comes on screen", () => {
  expect(failedRead("settings", "database is locked", true)).toBe("Could not read the settings: database is locked · showing the last reading");
});

test("before any good read there is no last reading to show, so the line does not claim one", () => {
  expect(failedRead("crew", "could not read the crew: no such table: crew_tasks", false)).toBe("Crew: could not read the crew: no such table: crew_tasks");
});

test("no failure, no line", () => {
  expect(failedRead("usage", null, true)).toBeNull();
  expect(failedRead("crew", null, false)).toBeNull();
});
