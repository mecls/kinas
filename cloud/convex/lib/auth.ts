// Who may call the store (build spec §6.11, §10): the companion by a secret whose SHA-256 is the deployment's
// `COMPANION_SECRET_SHA256`; a paired phone by a device token whose hash is its row's; a phone being paired by a code,
// once, within ten minutes, five tries. Only hashes are ever stored or compared. All of it is pure, so it is tested
// without a deployment.

export const PAIR_TTL_MS = 10 * 60_000;
export const PAIR_TRIES = 5;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equal strings, in time that does not depend on where they first differ. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The companion's secret against the hash in the deployment's environment; no hash set means nobody is let in. */
export async function companionOk(secret: string, expectedSha256: string | undefined): Promise<boolean> {
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256) || secret === "") return false;
  return sameHex(await sha256Hex(secret), expectedSha256);
}

/** 32 random bytes, base64url: a device's token, shown to the phone once. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** A pairing code as a person types it: Crockford's base32, in capitals, no spaces or dashes. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "").replaceAll("O", "0").replaceAll("I", "1").replaceAll("L", "1");
}

export interface PairingRow {
  codeHash: string;
  expiresAt: number;
  usedAt?: number;
  tries: number;
}

export type PairVerdict = "ok" | "none" | "expired" | "used" | "tries" | "wrong";

/**
 * Whether `givenHash` finishes the open pairing. Wrong guesses count against the row, so a code can be tried five times
 * and then is dead; a used or expired code never works. The caller records a "wrong" as one more try.
 */
export function pairVerdict(row: PairingRow | null, givenHash: string, now: number): PairVerdict {
  if (row === null) return "none";
  if (row.usedAt !== undefined) return "used";
  if (now >= row.expiresAt) return "expired";
  if (row.tries >= PAIR_TRIES) return "tries";
  return sameHex(row.codeHash, givenHash) ? "ok" : "wrong";
}

/** The words a refusal is shown in on the phone: none names a code or a time. */
export const PAIR_WORDS: Record<Exclude<PairVerdict, "ok">, string> = {
  none: "No pairing is open. Start one from Settings on the Mac.",
  expired: "That code has expired. Start a new one from Settings on the Mac.",
  used: "That code was already used. Start a new one from Settings on the Mac.",
  tries: "Too many tries. Start a new code from Settings on the Mac.",
  wrong: "That isn't the code. Check it and try again.",
};
