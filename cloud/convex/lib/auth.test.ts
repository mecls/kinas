import { expect, test } from "bun:test";
import { PAIR_TRIES, PAIR_TTL_MS, companionOk, newToken, normalizeCode, pairVerdict, sameHex, sha256Hex, type PairingRow } from "./auth.ts";

test("sha256Hex is SHA-256", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the companion gets in only with the secret whose hash the deployment holds", async () => {
  const hash = await sha256Hex("s3cret");
  expect(await companionOk("s3cret", hash)).toBe(true);
  expect(await companionOk("s3cret ", hash)).toBe(false);
  expect(await companionOk("", hash)).toBe(false);
  expect(await companionOk("s3cret", undefined)).toBe(false);
  expect(await companionOk("s3cret", "")).toBe(false);
  expect(await companionOk("s3cret", "not-a-hash")).toBe(false);
  expect(await companionOk(hash, hash)).toBe(false);
});

test("sameHex compares the whole string", () => {
  expect(sameHex("abcd", "abcd")).toBe(true);
  expect(sameHex("abcd", "abce")).toBe(false);
  expect(sameHex("abcd", "abc")).toBe(false);
  expect(sameHex("", "")).toBe(true);
});

test("a token is 32 random bytes in base64url and never repeats", () => {
  const a = newToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newToken()).not.toBe(a);
});

test("a typed code is read as Crockford's base32, in capitals", () => {
  expect(normalizeCode("ab3k-9xzq")).toBe("AB3K9XZQ");
  expect(normalizeCode(" a b3k 9xzq ")).toBe("AB3K9XZQ");
  expect(normalizeCode("OIl1")).toBe("0111");
});

const row = (over: Partial<PairingRow> = {}): PairingRow => ({ codeHash: "aa", expiresAt: 1_000_000 + PAIR_TTL_MS, tries: 0, ...over });

test("pairing: the right code, once, in time, finishes it", () => {
  expect(pairVerdict(row(), "aa", 1_000_000)).toBe("ok");
});

test("pairing: no open pairing, a used one and an expired one never work, even with the right code", () => {
  expect(pairVerdict(null, "aa", 1_000_000)).toBe("none");
  expect(pairVerdict(row({ usedAt: 999_999 }), "aa", 1_000_000)).toBe("used");
  expect(pairVerdict(row(), "aa", 1_000_000 + PAIR_TTL_MS)).toBe("expired");
  expect(pairVerdict(row(), "aa", 1_000_000 + PAIR_TTL_MS - 1)).toBe("ok");
});

test("pairing: five wrong tries kill the code, the right one included", () => {
  expect(pairVerdict(row(), "bb", 1_000_000)).toBe("wrong");
  expect(pairVerdict(row({ tries: PAIR_TRIES - 1 }), "bb", 1_000_000)).toBe("wrong");
  expect(pairVerdict(row({ tries: PAIR_TRIES }), "aa", 1_000_000)).toBe("tries");
});
