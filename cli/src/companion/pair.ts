// Pairing a phone (build spec §11.3 F; slice 8.1): the companion mints an eight-character code, sends the store only its
// SHA-256, and hands the code to the Mac once. The phone types it, or opens `<page>#pair=<code>`, and the store checks the
// hash, the ten minutes and the five tries (`cloud/convex/lib/auth.ts`). No code is stored, logged or sent again.

import { createHash, randomBytes } from "node:crypto";
import type { Cloud } from "./cloud.ts";

export const PAIR_TTL_MS = 10 * 60_000;
/** Crockford's base32: no I, L, O or U, so a code read aloud or from a screen is typed right. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Forty random bits as eight characters of five bits each. */
export function mintCode(bytes: Uint8Array = randomBytes(5)): string {
  let bits = 0n;
  for (const b of bytes.slice(0, 5)) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--) out += CODE_ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

export type PairStart = { code: string; url: string | null; expires_at: number } | { error: "no-cloud" | "cloud-failed" };

/** `mint` is replaced in tests. The store learns the hash and the expiry; the reply is the only place the code goes. */
export async function pairStart(cloud: Cloud | null, phoneUrl: string | null, now: number, mint: () => string = mintCode): Promise<PairStart> {
  if (cloud === null) return { error: "no-cloud" };
  const code = mint();
  const expiresAt = now + PAIR_TTL_MS;
  try {
    await cloud.startPairing(createHash("sha256").update(code).digest("hex"), expiresAt);
  } catch {
    return { error: "cloud-failed" };
  }
  return { code, url: phoneUrl === null ? null : `${phoneUrl.replace(/\/+$/, "")}/#pair=${code}`, expires_at: expiresAt };
}

export interface PhoneRow { id: string; name: string; paired_at: number; last_seen_at: number; push: boolean }

/** What the Mac shows of the paired phones: a name stripped to plain text, times and whether it takes notifications. */
export function phonesOf(rows: { id: string; name: string; pairedAt: number; lastSeenAt: number; push: boolean }[]): PhoneRow[] {
  return rows
    .filter((r) => /^[A-Za-z0-9_-]{1,64}$/.test(r.id))
    .map((r) => ({ id: r.id, name: r.name.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 60) || "Phone", paired_at: r.pairedAt, last_seen_at: r.lastSeenAt, push: r.push }));
}
