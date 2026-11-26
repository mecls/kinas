// The GitHub App that gives each worker its own token (ADR 0029; build spec §12 slice 5b.A).
//
// The captain registers one App with exactly contents and pull requests write and metadata read, and places its id
// and private key on the VPS by hand: `~/.local/state/kinas/github-app/app.json` and `key.pem`, each mode 600, in a
// folder of mode 700 (docs/external/github-app.md). Only this file reads the key; it is never logged, sent or copied.
//
// - `readApp`: the files, their modes and the key, or why not.
// - `jwt`: the App's own token, RS256, signed with node's crypto.
// - `repoOf`: `owner/name` from a clone's origin, for github.com only.
// - `installationOf`, `mint`, `revoke`: a token for one repository and the three permissions, and its end.
// - `githubAppRow`: setup's row, which turns green only when GitHub reports exactly those three permissions.

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Paths } from "./paths.ts";
import type { Check } from "./setup.ts";

/** The token's permissions, and the App's own: exactly these (the captain's term 1, 2026-11-26). */
export const APP_PERMISSIONS = { contents: "write", pull_requests: "write", metadata: "read" } as const;
/** A token is renewed with this long or less left (ADR 0029); GitHub's last one hour. */
export const RENEW_BEFORE_MS = 15 * 60_000;
export const API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

/** The one call this file makes: a fixed URL on api.github.com, a method, headers, a JSON body. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export interface AppDeps {
  paths: Pick<Paths, "state">;
  uid: number;
  fetch: Fetch;
  now: () => number;
}

export interface App {
  /** The JWT's issuer: the App's id or its client id, as app.json gives it. */
  iss: string;
  key: KeyObject;
}

export type Repo = { owner: string; name: string };

export const appDir = (paths: Pick<Paths, "state">) => join(paths.state, "github-app");

/** A real file or folder (never a link), the companion user's own, with exactly `mode`; else why not. */
function ownedWithMode(path: string, uid: number, mode: number, what: string, dir: boolean): string | null {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return `${what} isn't there`;
  }
  if (dir ? !st.isDirectory() : !st.isFile()) return `${what} isn't a plain ${dir ? "folder" : "file"}`;
  if (st.uid !== uid) return `${what} isn't this user's`;
  if ((st.mode & 0o777) !== mode) return `${what} must be mode ${mode.toString(8)}, not ${(st.mode & 0o777).toString(8)}`;
  return null;
}

/** The App's files, as the captain placed them, or the first thing wrong with them. */
export function readApp(paths: Pick<Paths, "state">, uid: number): App | { problem: string } {
  const dir = appDir(paths);
  const bad =
    ownedWithMode(dir, uid, 0o700, "~/.local/state/kinas/github-app", true) ??
    ownedWithMode(join(dir, "app.json"), uid, 0o600, "app.json", false) ??
    ownedWithMode(join(dir, "key.pem"), uid, 0o600, "key.pem", false);
  if (bad !== null) return { problem: bad };
  let iss: string | null = null;
  try {
    const doc = JSON.parse(readFileSync(join(dir, "app.json"), "utf8")) as Record<string, unknown>;
    const id = doc.app_id ?? doc.client_id;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) iss = String(id);
    else if (typeof id === "string" && /^[A-Za-z0-9.]{1,64}$/.test(id)) iss = id;
  } catch {
    return { problem: "app.json isn't JSON" };
  }
  if (iss === null) return { problem: 'app.json needs "app_id" (or "client_id")' };
  let key: KeyObject;
  try {
    key = createPrivateKey(readFileSync(join(dir, "key.pem")));
  } catch {
    return { problem: "key.pem isn't a private key" };
  }
  if (key.asymmetricKeyType !== "rsa") return { problem: "key.pem isn't the App's RSA key" };
  return { iss, key };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The App's JWT: issued a minute back for clock drift, good for nine minutes (GitHub allows ten). */
export function jwt(app: App, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: app.iss }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), app.key);
  return `${head}.${body}.${b64url(sig)}`;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** `owner/name` from an origin URL on github.com — ssh (both spellings) or https — and nothing else. */
export function repoOf(url: string): Repo | null {
  const m =
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url) ??
    /^ssh:\/\/git@github\.com(?::22)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url) ??
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  const [, owner, name] = m as unknown as [string, string, string];
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}

async function call(d: AppDeps, method: string, path: string, auth: string, body?: unknown): Promise<{ status: number; doc: unknown } | { problem: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await d.fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${auth}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kinas-companion",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: ctl.signal,
    });
    const text = await res.text();
    let doc: unknown = null;
    try {
      doc = text === "" ? null : JSON.parse(text);
    } catch {
      doc = null;
    }
    return { status: res.status, doc };
  } catch {
    return { problem: "GitHub didn't answer" };
  } finally {
    clearTimeout(timer);
  }
}

const field = (doc: unknown, k: string): unknown => (doc && typeof doc === "object" ? (doc as Record<string, unknown>)[k] : undefined);

/** Exactly the three permissions, no more and no less. */
export function exactPermissions(p: unknown): boolean {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const want = Object.entries(APP_PERMISSIONS);
  const got = Object.entries(p as Record<string, unknown>);
  return got.length === want.length && want.every(([k, v]) => (p as Record<string, unknown>)[k] === v);
}

const describe = (p: unknown) =>
  p && typeof p === "object"
    ? Object.entries(p as Record<string, unknown>)
        .map(([k, v]) => `${k} ${String(v)}`)
        .sort()
        .join(", ")
    : "none";

/** The App's installation for one repository: refused when the App isn't installed there. */
export async function installationOf(d: AppDeps, app: App, repo: Repo): Promise<{ id: number } | { problem: string }> {
  const r = await call(d, "GET", `/repos/${repo.owner}/${repo.name}/installation`, jwt(app, d.now()));
  if ("problem" in r) return r;
  if (r.status === 404) return { problem: `the App isn't installed on ${repo.owner}/${repo.name}` };
  if (r.status === 401) return { problem: "GitHub refused the App's key" };
  const id = field(r.doc, "id");
  if (r.status !== 200 || typeof id !== "number" || !Number.isSafeInteger(id)) return { problem: `GitHub answered ${r.status} for the App's installation` };
  return { id };
}

const TOKEN = /^ghs_[A-Za-z0-9_.-]{16,4096}$/;

export interface Minted {
  token: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/**
 * A token for one repository and the three permissions. Refused unless GitHub's answer says exactly that: a token
 * reaching further than asked is never written.
 */
export async function mint(d: AppDeps, app: App, installation: number, repo: Repo): Promise<Minted | { problem: string }> {
  const r = await call(d, "POST", `/app/installations/${installation}/access_tokens`, jwt(app, d.now()), { repositories: [repo.name], permissions: APP_PERMISSIONS });
  if ("problem" in r) return r;
  if (r.status !== 201) return { problem: `GitHub answered ${r.status} for a token` };
  const token = field(r.doc, "token");
  const expires = Date.parse(String(field(r.doc, "expires_at") ?? ""));
  if (typeof token !== "string" || !TOKEN.test(token) || !Number.isFinite(expires)) return { problem: "GitHub's token answer can't be read" };
  if (!exactPermissions(field(r.doc, "permissions"))) return { problem: `GitHub's token carries ${describe(field(r.doc, "permissions"))}, not the three asked for` };
  const repos = field(r.doc, "repositories");
  const names = Array.isArray(repos) ? repos.map((x) => field(x, "full_name")) : null;
  if (field(r.doc, "repository_selection") !== "selected" || names === null || names.length !== 1 || String(names[0]).toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()) {
    return { problem: "GitHub's token reaches more than the task's repository" };
  }
  return { token, expiresAt: expires };
}

/** Ends a token before its hour (204). A token already expired or revoked answers 401: ended either way. */
export async function revoke(d: AppDeps, token: string): Promise<boolean> {
  const r = await call(d, "DELETE", "/installation/token", token);
  return !("problem" in r) && (r.status === 204 || r.status === 401);
}

/** The App GitHub knows, with exactly the three permissions; else why not. */
export async function appCheck(d: AppDeps, app: App): Promise<{ name: string } | { problem: string }> {
  const r = await call(d, "GET", "/app", jwt(app, d.now()));
  if ("problem" in r) return r;
  if (r.status === 401) return { problem: "GitHub refused the App's key: check app.json's id and key.pem" };
  if (r.status !== 200) return { problem: `GitHub answered ${r.status} for the App` };
  const perms = field(r.doc, "permissions");
  if (!exactPermissions(perms)) return { problem: `the App has ${describe(perms)}: it must have exactly contents write, pull requests write, metadata read` };
  const name = field(r.doc, "slug") ?? field(r.doc, "name");
  return { name: typeof name === "string" ? name.slice(0, 60) : "the App" };
}

/** Setup's GitHub App row: until it is green, no worker starts (worker-launch can't mint). */
export async function githubAppRow(d: AppDeps): Promise<Check> {
  const app = readApp(d.paths, d.uid);
  if ("problem" in app) {
    const placed = !app.problem.startsWith("~/.local/state/kinas/github-app isn't there");
    return { id: "github-app", state: "bad", detail: placed ? `${app.problem}: no worker starts until it's right` : "not set up: no worker starts until the App's id and key are in ~/.local/state/kinas/github-app" };
  }
  const known = await appCheck(d, app);
  if ("problem" in known) return { id: "github-app", state: "bad", detail: `${known.problem}: no worker starts until it's right` };
  return { id: "github-app", state: "ok", detail: `${known.name} · contents and pull requests write, metadata read · a token per task` };
}
