import { expect, test } from "bun:test";
import { BODY_MAX, UNREACHABLE_AFTER_MS, alertVerdict, backPayload, clockIn, itemPayload, payloadViolation, testPayload, unreachablePayload } from "./push.ts";

const item = { key: "fix-login@license@1700000000000", project: "shop", title: "Stock webhook", question: "Keep the CSV import for one release?\nThe supplier signs with a shared secret.\nOr remove it in this PR?" };

test("an item's notification is `project · title`, the question's first line, and its address", () => {
  const p = itemPayload(item);
  expect(p).toEqual({ title: "shop · Stock webhook", body: "Keep the CSV import for one release?", url: "/#item=fix-login%40license%401700000000000" });
  expect(payloadViolation(p)).toBeNull();
  expect(Object.keys(p).sort()).toEqual(["body", "title", "url"]);
});

test("the body is one line of at most 120 characters, however long or multi-line the question is", () => {
  const long = itemPayload({ ...item, question: `${"q".repeat(300)}\nsecond` });
  expect([...long.body].length).toBe(BODY_MAX);
  expect(long.body.endsWith("…")).toBe(true);
  expect(itemPayload({ ...item, question: `\n\n  first real line  \nnext` }).body).toBe("first real line");
  expect([...itemPayload({ ...item, question: "é".repeat(500) }).body].length).toBe(BODY_MAX);
  expect(itemPayload({ ...item, question: "" }).body).toBe("");
});

test("control characters and line breaks never reach a title or body", () => {
  const p = itemPayload({ ...item, project: "sh\nop", title: "a\u0007b\tc", question: "x\u001b[31my" });
  expect(p.title).toBe("sh op · a b c");
  expect(p.body).toBe("x [31my");
  expect(payloadViolation(p)).toBeNull();
  expect(itemPayload({ ...item, project: "", title: "" }).title).toBe("Kinas");
  expect(itemPayload({ ...item, project: "", title: "Only a title" }).title).toBe("Only a title");
});

test("unreachable and back say the machine's label and the time, nothing else", () => {
  const since = Date.UTC(2026, 10, 27, 12, 51);
  expect(unreachablePayload("homelab", since, "UTC")).toEqual({ title: "homelab", body: "Kinas can't reach the Linux machine since 12:51", url: "/" });
  expect(unreachablePayload("homelab", since, "Europe/Lisbon").body).toBe("Kinas can't reach the Linux machine since 12:51");
  expect(unreachablePayload("homelab", Date.UTC(2026, 5, 27, 12, 51), "Europe/Lisbon").body).toBe("Kinas can't reach the Linux machine since 13:51");
  expect(backPayload("homelab")).toEqual({ title: "homelab", body: "Kinas reads the Linux machine again", url: "/" });
  expect(testPayload()).toEqual({ title: "Kinas", body: "A test notification from Settings", url: "/" });
  for (const p of [unreachablePayload("x", 0, "UTC"), backPayload("x"), testPayload()]) expect(payloadViolation(p)).toBeNull();
  expect(clockIn(since, "Not/AZone")).toBe("12:51 UTC");
});

test("a payload with another field, a long body or an address off the page is refused", () => {
  const ok = itemPayload(item);
  expect(payloadViolation({ ...ok, answer: "MIT" })).toMatch(/field a notification doesn't carry: answer/);
  expect(payloadViolation({ ...ok, body: "b".repeat(BODY_MAX + 1) })).toMatch(/body is over 120/);
  expect(payloadViolation({ ...ok, url: "https://evil.example/" })).toMatch(/not an address on the page/);
  expect(payloadViolation({ ...ok, url: "/#item=<x>" })).toMatch(/not an address on the page/);
  expect(payloadViolation({ ...ok, title: "a\nb" })).toMatch(/control character/);
  expect(payloadViolation(null)).toBe("not an object");
  expect(payloadViolation({ title: 1, body: "", url: "/" })).toMatch(/strings/);
});

test("the watch: silent over ten minutes says unreachable once, a beat after says back once, nothing repeats", () => {
  const now = 100 * 60_000;
  const fresh = now - 30_000;
  const old = now - UNREACHABLE_AFTER_MS - 1;
  expect(alertVerdict({ beatAt: fresh, now, last: null })).toBeNull();
  expect(alertVerdict({ beatAt: old, now, last: null })).toBe("unreachable");
  expect(alertVerdict({ beatAt: now - UNREACHABLE_AFTER_MS, now, last: null })).toBeNull();
  expect(alertVerdict({ beatAt: old, now, last: { kind: "unreachable", at: now - 1000 } })).toBeNull();
  expect(alertVerdict({ beatAt: fresh, now, last: { kind: "unreachable", at: now - 60_000 } })).toBe("back");
  expect(alertVerdict({ beatAt: fresh, now, last: { kind: "back", at: now - 10_000 } })).toBeNull();
  expect(alertVerdict({ beatAt: old, now, last: { kind: "back", at: now - 10_000 } })).toBe("unreachable");
  expect(alertVerdict({ beatAt: null, now, last: null })).toBeNull();
  expect(alertVerdict({ beatAt: now - 90_000_000, now, last: { kind: "unreachable", at: now - 90_000_000 + 1 } })).toBeNull();
});
