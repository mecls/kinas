import { expect, test } from "bun:test";
import { dayWords, expiryWords, groupCode, lastSeenWords, notificationsWords, REMOVE_WARNING } from "./phonesView.ts";

const NOW = new Date(2026, 10, 27, 14, 30).getTime();
const at = (h: number, m: number, day = 27) => new Date(2026, 10, day, h, m).getTime();

test("a code is shown in two groups of four, and copied as it is", () => {
  expect(groupCode("AB3K9XZQ")).toBe("AB3K-9XZQ");
  expect(groupCode("short")).toBe("short");
});

test("the code's life: the minutes left, then expired", () => {
  expect(expiryWords(NOW + 10 * 60_000, NOW)).toBe("Expires in 10 min, at 14:40");
  expect(expiryWords(NOW + 61_000, NOW)).toBe("Expires in 2 min, at 14:31");
  expect(expiryWords(NOW + 59_000, NOW)).toBe("Expires in under a minute, at 14:30");
  expect(expiryWords(NOW, NOW)).toBe("Expired");
  expect(expiryWords(NOW - 5, NOW)).toBe("Expired");
});

test("a day is today's clock, or the date", () => {
  expect(dayWords(at(9, 5), NOW)).toBe("today 09:05");
  expect(dayWords(at(23, 59, 26), NOW)).toBe("26 Nov");
  expect(dayWords(new Date(2025, 0, 3, 8, 0).getTime(), NOW)).toBe("3 Jan 2025");
});

test("last seen is an age, never a time of day", () => {
  expect(lastSeenWords(NOW - 20_000, NOW)).toBe("just now");
  expect(lastSeenWords(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
  expect(lastSeenWords(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
  expect(lastSeenWords(NOW - 50 * 3_600_000, NOW)).toBe("2 d ago");
  expect(lastSeenWords(NOW + 90_000, NOW)).toBe("just now");
});

test("notifications are on or off, and removing says what it does", () => {
  expect(notificationsWords(true)).toBe("on");
  expect(notificationsWords(false)).toBe("off");
  expect(REMOVE_WARNING).toBe("This phone stops working. Pair it again to use it.");
});
