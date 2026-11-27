import { expect, test } from "bun:test";
import { PUSH_WORDS, bytesToBase64Url, pushState, subscriptionOf, urlBase64ToUint8Array } from "./push.ts";

test("base64url converts both ways, with and without padding", () => {
  const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3]);
  const text = bytesToBase64Url(bytes);
  expect(text).toBe("-__-AAECAw");
  expect([...urlBase64ToUint8Array(text)]).toEqual([...bytes]);
  expect(bytesToBase64Url(null)).toBe("");
  expect(bytesToBase64Url(bytes.buffer)).toBe(text);
  expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
});

test("a subscription is stored as its address and its two keys", () => {
  const keys: Record<string, Uint8Array> = { p256dh: new Uint8Array([1, 2, 3]), auth: new Uint8Array([4, 5]) };
  const s = subscriptionOf({ endpoint: "https://web.push.apple.com/x", getKey: (n) => keys[n]!.buffer as ArrayBuffer });
  expect(s).toEqual({ endpoint: "https://web.push.apple.com/x", p256dh: "AQID", auth: "BAU" });
});

test("where the browser stands: iOS outside the home screen is told to add the page, a denial is blocked, on needs both", () => {
  const base = { hasPush: true, standalone: true, ios: true, permission: "default" as const, subscribed: false };
  expect(pushState({ ...base, hasPush: false, standalone: false })).toBe("needs-home-screen");
  expect(pushState({ ...base, hasPush: false, ios: false })).toBe("unsupported");
  expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
  expect(pushState(base)).toBe("off");
  expect(pushState({ ...base, permission: "granted" })).toBe("off");
  expect(pushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
  expect(PUSH_WORDS.on).toBe("Notifications are on.");
});
