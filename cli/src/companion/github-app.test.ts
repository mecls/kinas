import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_PERMISSIONS, appDir, githubAppRow, installationOf, jwt, mint, readApp, repoOf, revoke, type AppDeps, type Fetch } from "./github-app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const uid = process.getuid!();

function placed(opts: { dirMode?: number; keyMode?: number; json?: string; key?: string } = {}) {
  const state = mkdtempSync(join(tmpdir(), "kinas-app-"));
  const dir = appDir({ state });
  mkdirSync(dir);
  writeFileSync(join(dir, "app.json"), opts.json ?? '{"app_id": 123456}\n');
  writeFileSync(join(dir, "key.pem"), opts.key ?? PEM);
  chmodSync(join(dir, "app.json"), 0o600);
  chmodSync(join(dir, "key.pem"), opts.keyMode ?? 0o600);
  chmodSync(dir, opts.dirMode ?? 0o700);
  return { state, dir };
}

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function github(answers: Record<string, { status: number; body?: unknown }>): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: Fetch = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) });
    const a = answers[`${init.method} ${url}`] ?? { status: 599 };
    return { status: a.status, text: async () => (a.body === undefined ? "" : JSON.stringify(a.body)) };
  };
  return { fetch, seen };
}

const NOW = Date.parse("2026-11-26T12:00:00Z");
const deps = (state: string, fetch: Fetch): AppDeps => ({ paths: { state }, uid, fetch, now: () => NOW });

describe("the App's files", () => {
  test("placed as the captain is told: the id and the key", () => {
    const app = readApp({ state: placed().state }, uid);
    expect("problem" in app).toBe(false);
    if (!("problem" in app)) expect(app.iss).toBe("123456");
  });

  test("a client id is accepted as the issuer", () => {
    const app = readApp({ state: placed({ json: '{"client_id": "Iv23liAbC.def"}' }).state }, uid);
    expect("problem" in app ? app.problem : app.iss).toBe("Iv23liAbC.def");
  });

  test("not there: said so", () => {
    const state = mkdtempSync(join(tmpdir(), "kinas-app-"));
    expect(readApp({ state }, uid)).toEqual({ problem: "~/.local/state/kinas/github-app isn't there" });
  });

  test("a folder others can read, or a key others can read, is refused", () => {
    expect(readApp({ state: placed({ dirMode: 0o755 }).state }, uid)).toEqual({ problem: "~/.local/state/kinas/github-app must be mode 700, not 755" });
    expect(readApp({ state: placed({ keyMode: 0o644 }).state }, uid)).toEqual({ problem: "key.pem must be mode 600, not 644" });
  });

  test("a key that is a link is refused, wherever it points", () => {
    const { state, dir } = placed();
    const elsewhere = join(state, "real.pem");
    writeFileSync(elsewhere, PEM, { mode: 0o600 });
    chmodSync(dir, 0o700);
    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(join(dir, "key.pem"));
    symlinkSync(elsewhere, join(dir, "key.pem"));
    expect(readApp({ state }, uid)).toEqual({ problem: "key.pem isn't a plain file" });
  });

  test("no id, or no key in key.pem: refused", () => {
    expect(readApp({ state: placed({ json: "{}" }).state }, uid)).toEqual({ problem: 'app.json needs "app_id" (or "client_id")' });
    expect(readApp({ state: placed({ json: '{"app_id": "1; rm"}' }).state }, uid)).toEqual({ problem: 'app.json needs "app_id" (or "client_id")' });
    expect(readApp({ state: placed({ key: "not a key" }).state }, uid)).toEqual({ problem: "key.pem isn't a private key" });
  });
});

describe("the App's JWT", () => {
  test("RS256, signed by the App's key, issued a minute back and good for nine minutes", () => {
    const app = readApp({ state: placed().state }, uid);
    if ("problem" in app) throw new Error(app.problem);
    const [h, b, s] = jwt(app, NOW).split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: "123456" });
    expect(verify("sha256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("the repository from a clone's origin", () => {
  test("github.com over ssh, either spelling, or https", () => {
    for (const url of ["git@github.com:mecls/kinas.git", "git@github.com:mecls/kinas", "ssh://git@github.com/mecls/kinas.git", "ssh://git@github.com:22/mecls/kinas", "https://github.com/mecls/kinas.git", "https://github.com/mecls/kinas/"]) {
      expect(repoOf(url)).toEqual({ owner: "mecls", name: "kinas" });
    }
  });

  test("anything else is no repository", () => {
    for (const url of ["git@gitlab.com:a/b.git", "https://github.com.evil.example/a/b", "https://user@github.com/a/b", "http://github.com/a/b", "git@github.com:a/b/c", "git@github.com:-a/b", "git@github.com:a/..", "git@github.com:a/b c", "/srv/repo.git", ""]) {
      expect(repoOf(url)).toBeNull();
    }
  });
});

describe("tokens", () => {
  const repo = { owner: "mecls", name: "kinas" };
  const good = {
    token: "ghs_16C7e42F292c6912E7710c838347Ae178B4a",
    expires_at: "2026-11-26T13:00:00Z",
    permissions: { contents: "write", pull_requests: "write", metadata: "read" },
    repository_selection: "selected",
    repositories: [{ full_name: "mecls/kinas" }],
  };

  test("the installation for the task's repository, asked with the App's JWT", async () => {
    const { state } = placed();
    const app = readApp({ state }, uid);
    if ("problem" in app) throw new Error(app.problem);
    const gh = github({ "GET https://api.github.com/repos/mecls/kinas/installation": { status: 200, body: { id: 42 } } });
    expect(await installationOf(deps(state, gh.fetch), app, repo)).toEqual({ id: 42 });
    expect(gh.seen[0]!.headers.Authorization).toBe(`Bearer ${jwt(app, NOW)}`);
  });

  test("not installed there: the launch is refused with why", async () => {
    const { state } = placed();
    const app = readApp({ state }, uid);
    if ("problem" in app) throw new Error(app.problem);
    const gh = github({ "GET https://api.github.com/repos/mecls/kinas/installation": { status: 404, body: { message: "Not Found" } } });
    expect(await installationOf(deps(state, gh.fetch), app, repo)).toEqual({ problem: "the App isn't installed on mecls/kinas" });
  });

  test("a token is asked for one repository and the three permissions, and kept only if GitHub says exactly that", async () => {
    const { state } = placed();
    const app = readApp({ state }, uid);
    if ("problem" in app) throw new Error(app.problem);
    const gh = github({ "POST https://api.github.com/app/installations/42/access_tokens": { status: 201, body: good } });
    expect(await mint(deps(state, gh.fetch), app, 42, repo)).toEqual({ token: good.token, expiresAt: Date.parse("2026-11-26T13:00:00Z") });
    expect(JSON.parse(gh.seen[0]!.body!)).toEqual({ repositories: ["kinas"], permissions: APP_PERMISSIONS });
  });

  test("a token with more permissions, or more repositories, is refused and never written", async () => {
    const { state } = placed();
    const app = readApp({ state }, uid);
    if ("problem" in app) throw new Error(app.problem);
    const more = github({ "POST https://api.github.com/app/installations/42/access_tokens": { status: 201, body: { ...good, permissions: { ...good.permissions, workflows: "write" } } } });
    expect(await mint(deps(state, more.fetch), app, 42, repo)).toEqual({ problem: "GitHub's token carries contents write, metadata read, pull_requests write, workflows write, not the three asked for" });
    const all = github({ "POST https://api.github.com/app/installations/42/access_tokens": { status: 201, body: { ...good, repository_selection: "all" } } });
    expect(await mint(deps(state, all.fetch), app, 42, repo)).toEqual({ problem: "GitHub's token reaches more than the task's repository" });
    const other = github({ "POST https://api.github.com/app/installations/42/access_tokens": { status: 201, body: { ...good, repositories: [{ full_name: "mecls/glyph" }] } } });
    expect(await mint(deps(state, other.fetch), app, 42, repo)).toEqual({ problem: "GitHub's token reaches more than the task's repository" });
    const odd = github({ "POST https://api.github.com/app/installations/42/access_tokens": { status: 201, body: { ...good, token: "ghs_x\n[credential]" } } });
    expect(await mint(deps(state, odd.fetch), app, 42, repo)).toEqual({ problem: "GitHub's token answer can't be read" });
  });

  test("revoking uses the token itself; one already ended counts as ended", async () => {
    const gh = github({ "DELETE https://api.github.com/installation/token": { status: 204 } });
    expect(await revoke(deps("/nowhere", gh.fetch), "ghs_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(gh.seen[0]!.headers.Authorization).toBe("Bearer ghs_abcdefghijklmnopqrstuvwxyz");
    const gone = github({ "DELETE https://api.github.com/installation/token": { status: 401 } });
    expect(await revoke(deps("/nowhere", gone.fetch), "ghs_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    const down = github({});
    expect(await revoke(deps("/nowhere", down.fetch), "ghs_abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
});

describe("setup's GitHub App row", () => {
  test("not set up: bad, and no worker starts", async () => {
    const state = mkdtempSync(join(tmpdir(), "kinas-app-"));
    expect(await githubAppRow(deps(state, github({}).fetch))).toEqual({ id: "github-app", state: "bad", detail: "not set up: no worker starts until the App's id and key are in ~/.local/state/kinas/github-app" });
  });

  test("an App with a permission more than the three is bad, naming what it has", async () => {
    const { state } = placed();
    const gh = github({ "GET https://api.github.com/app": { status: 200, body: { slug: "kinas-workers", permissions: { ...APP_PERMISSIONS, workflows: "write" } } } });
    expect(await githubAppRow(deps(state, gh.fetch))).toEqual({
      id: "github-app",
      state: "bad",
      detail: "the App has contents write, metadata read, pull_requests write, workflows write: it must have exactly contents write, pull requests write, metadata read: no worker starts until it's right",
    });
  });

  test("exactly the three: ok", async () => {
    const { state } = placed();
    const gh = github({ "GET https://api.github.com/app": { status: 200, body: { slug: "kinas-workers", permissions: { metadata: "read", contents: "write", pull_requests: "write" } } } });
    expect(await githubAppRow(deps(state, gh.fetch))).toEqual({ id: "github-app", state: "ok", detail: "kinas-workers · contents and pull requests write, metadata read · a token per task" });
  });
});
