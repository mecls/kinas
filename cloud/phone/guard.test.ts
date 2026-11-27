import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { connectSrc, policy } from "./vite.config.ts";

// The phone page's rules (build spec §10): no innerHTML, no eval, nothing from another origin, and a policy that lets it
// talk to one Convex deployment and nothing else.

const src = join(import.meta.dir, "src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const code = files(src).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));

test("no source writes HTML from a string, evaluates one, or reaches another origin", () => {
  expect(code.length).toBeGreaterThan(5);
  for (const f of code) {
    const text = readFileSync(f, "utf8");
    expect(text, f).not.toMatch(/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    expect(text, f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket\(|sendBeacon|https?:\/\/(?!www\.w3\.org)/);
  }
});

test("a phone's token is read and written in one file only, and never put in an address", () => {
  const users = code.filter((f) => /localStorage/.test(readFileSync(f, "utf8"))).map((f) => f.slice(src.length + 1));
  expect(users).toEqual(["store.ts"]);
  for (const f of code) expect(readFileSync(f, "utf8"), f).not.toMatch(/location\.(search|href)\s*=|pushState\([^)]*token|replaceState\([^)]*token/);
});

test("the policy allows scripts and styles from itself, one deployment's https and wss, and nothing else", () => {
  expect(connectSrc("https://happy-otter-123.eu-west-1.convex.cloud")).toBe("'self' https://happy-otter-123.eu-west-1.convex.cloud wss://happy-otter-123.eu-west-1.convex.cloud");
  expect(connectSrc(undefined)).toBe("'self'");
  const p = policy("https://happy-otter-123.convex.cloud");
  expect(p).toContain("default-src 'self'");
  expect(p).toContain("script-src 'self'");
  expect(p).not.toContain("unsafe-eval");
  expect(p).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(p).toContain("frame-ancestors 'none'");
  expect(p).toContain("form-action 'none'");
  expect(p).toContain("object-src 'none'");
  expect(p.match(/connect-src[^;]*/)![0]).not.toContain("*");
});
