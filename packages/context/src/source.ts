// Every source is best-effort and stamped: a missing source becomes one honest line, never a crash and never a
// fake number.

import type { Section } from "./packet.ts";

/** The source is missing or broken. The message is the one line shown in its place. */
export class SourceError extends Error {}

/** The source is there but slow. A previous reading, if any, is kept with its own timestamp. */
export class SourceTimeout extends Error {}

export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SourceTimeout(`${what}: no answer within ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Reads one source into a section. A timeout keeps the previous good reading; any other failure is one line. */
export async function settle<T>(read: () => Promise<T>, empty: T, now: number, previous?: Section<T>): Promise<Section<T>> {
  try {
    return { state: "ok", note: null, at: now, data: await read() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof SourceTimeout && previous?.state === "ok") return { ...previous, note: message };
    return { state: "unavailable", note: message, at: now, data: empty };
  }
}

export function pending<T>(empty: T, now: number): Section<T> {
  return { state: "pending", note: null, at: now, data: empty };
}
