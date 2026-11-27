import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Cloud } from "./cloud.ts";
import { CODE_ALPHABET, PAIR_TTL_MS, mintCode, pairStart, phonesOf } from "./pair.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function cloudWith(over: Partial<Cloud> = {}): Cloud & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    replaceReading: async () => {},
    heartbeat: async () => {},
    takeAnswers: async () => [],
    settleAnswer: async () => {},
    startPairing: async (hash, at) => void calls.push(`pair ${hash} ${at}`),
    phones: async () => [],
    unpair: async (id) => void calls.push(`unpair ${id}`),
    testNotification: async () => {},
    ...over,
  };
}

test("a code is eight characters of Crockford's base32, forty bits", () => {
  const code = mintCode(new Uint8Array([0, 0, 0, 0, 0]));
  expect(code).toBe("00000000");
  expect(mintCode(new Uint8Array([255, 255, 255, 255, 255]))).toBe("ZZZZZZZZ");
  expect(mintCode(new Uint8Array([0x08, 0x62, 0x8c, 0xf1, 0x24]))).toBe("11H8SW94");
  const random = mintCode();
  expect(random).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  expect(CODE_ALPHABET).toHaveLength(32);
  expect(new Set(CODE_ALPHABET).size).toBe(32);
  expect(mintCode()).not.toBe(random);
});

test("pair-start gives the code once and the store only its hash, for ten minutes", async () => {
  const cloud = cloudWith();
  const r = await pairStart(cloud, "https://phone.example.app/", 1_000, () => "AB3K9XZQ");
  expect(r).toEqual({ code: "AB3K9XZQ", url: "https://phone.example.app/#pair=AB3K9XZQ", expires_at: 1_000 + PAIR_TTL_MS });
  expect(cloud.calls).toEqual([`pair ${sha("AB3K9XZQ")} ${1_000 + PAIR_TTL_MS}`]);
  expect(cloud.calls.join()).not.toContain("AB3K9XZQ");
});

test("without the page's address the Mac still gets the code, and without a cloud there is nothing to pair with", async () => {
  expect(await pairStart(cloudWith(), null, 1, () => "AB3K9XZQ")).toMatchObject({ code: "AB3K9XZQ", url: null });
  expect(await pairStart(null, null, 1)).toEqual({ error: "no-cloud" });
});

test("a pairing the store won't take is reported, and the code is not handed out", async () => {
  const cloud = cloudWith({ startPairing: async () => { throw new Error("boom"); } });
  expect(await pairStart(cloud, null, 1, () => "AB3K9XZQ")).toEqual({ error: "cloud-failed" });
});

test("phones are listed by name and times only; a name can't carry markup or control characters", () => {
  const rows = phonesOf([
    { id: "k5788xyz", name: "Miguel's iPhone", pairedAt: 1, lastSeenAt: 2, push: true },
    { id: "k5788abc", name: "<b>x</b>\u0007\n", pairedAt: 3, lastSeenAt: 4, push: false },
    { id: "bad id!", name: "ignored", pairedAt: 5, lastSeenAt: 6, push: false },
  ]);
  expect(rows).toEqual([
    { id: "k5788xyz", name: "Miguel's iPhone", paired_at: 1, last_seen_at: 2, push: true },
    { id: "k5788abc", name: "bx/b", paired_at: 3, last_seen_at: 4, push: false },
  ]);
});
