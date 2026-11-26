import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDir, type Fetch } from "./github-app.ts";
import { companionPaths } from "./paths.ts";
import { githubFile, hostsYml, readGithubRecord, tendTokens, workerToken, type TokenDeps } from "./tokens.ts";
import { tokenDir, workerTmp } from "./worker.ts";

// Each worker's own GitHub token (ADR 0029; build spec §12 slices 5b.B–5b.C).

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const NOW = Date.parse("2026-11-26T12:00:00Z");
const HOUR = 60 * 60_000;
const tok = (n: number) => `ghs_token${String(n).padStart(4, "0")}abcdefghijkl`;

function github(origin = "git@github.com:mecls/shop.git") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kinas-tokens-")));
  const paths = companionPaths({ KINAS_COMPANION_ROOT: root });
  mkdirSync(paths.workers, { recursive: true, mode: 0o700 });
  mkdirSync(join(paths.tmp, "kw"), { recursive: true, mode: 0o700 });
  // The App, as the captain places it.
  const app = appDir(paths);
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "app.json"), '{"app_id": 7}\n', { mode: 0o600 });
  writeFileSync(join(app, "key.pem"), PEM, { mode: 0o600 });
  chmodSync(app, 0o700);
  // A clone under <home>/projects/ and a worktree of it.
  const git = join(paths.home, "projects", "shop", ".git");
  mkdirSync(join(git, "worktrees", "1"), { recursive: true });
  writeFileSync(join(git, "config"), `[remote "origin"]\n\turl = ${origin}\n`);
  writeFileSync(join(git, "worktrees", "1", "commondir"), "../..\n");
  const wt = realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-")));
  writeFileSync(join(wt, ".git"), `gitdir: ${git}/worktrees/1\n`);
  // GitHub: one installation on mecls/shop; each token asked is the next number, good for an hour from `now`.
  const calls: string[] = [];
  let minted = 0;
  let installed = true;
  let now = NOW;
  const fetch: Fetch = async (url, init) => {
    const path = url.replace("https://api.github.com", "");
    calls.push(`${init.method} ${path}${init.method === "DELETE" ? ` ${init.headers.Authorization!.replace("Bearer ", "")}` : ""}`);
    const reply = (status: number, body?: unknown) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (init.method === "GET" && path === "/repos/mecls/shop/installation") return installed ? reply(200, { id: 42 }) : reply(404, { message: "Not Found" });
    if (init.method === "POST" && path === "/app/installations/42/access_tokens") {
      minted += 1;
      return reply(201, {
        token: tok(minted),
        expires_at: new Date(now + HOUR).toISOString(),
        permissions: { contents: "write", pull_requests: "write", metadata: "read" },
        repository_selection: "selected",
        repositories: [{ full_name: "mecls/shop" }],
      });
    }
    if (init.method === "DELETE" && path === "/installation/token") return reply(204);
    return reply(599);
  };
  const d: TokenDeps = { paths, uid: process.getuid!(), fetch, now: () => now };
  return {
    root,
    paths,
    wt,
    d,
    calls,
    uninstall: () => (installed = false),
    at: (t: number) => (now = t),
  };
}

describe("a worker's token at launch", () => {
  test("for the clone's repository: the token, gh's login and the record, each 600 in a 700 folder", async () => {
    const g = github();
    expect(await workerToken(g.d, "t1", g.wt)).toEqual({ ok: true });
    const dir = tokenDir(g.paths.workers, "t1");
    expect(readFileSync(join(dir, "token"), "utf8")).toBe(tok(1));
    expect(readFileSync(join(dir, "gh", "hosts.yml"), "utf8")).toBe(hostsYml(tok(1)));
    expect(readFileSync(join(dir, "gh", "config.yml"), "utf8")).toBe('version: "1"\n');
    for (const f of [dir, join(dir, "gh")]) expect(statSync(f).mode & 0o777).toBe(0o700);
    for (const f of ["token", "gh/config.yml", "gh/hosts.yml"]) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(readGithubRecord(githubFile(g.paths.workers, "t1"))).toEqual({ v: 1, repo: "mecls/shop", installation: 42, expires_at: NOW + HOUR });
    expect(g.calls).toEqual(["GET /repos/mecls/shop/installation", "POST /app/installations/42/access_tokens"]);
  });

  test("gh's login file is the shape gh reads without migrating", () => {
    expect(hostsYml("ghs_x")).toBe("github.com:\n    users:\n        x-access-token:\n            oauth_token: ghs_x\n    git_protocol: https\n    oauth_token: ghs_x\n    user: x-access-token\n");
  });

  test("a respawn gets a new token and ends the old one", async () => {
    const g = github();
    await workerToken(g.d, "t1", g.wt);
    expect(await workerToken(g.d, "t1", g.wt)).toEqual({ ok: true });
    expect(readFileSync(join(tokenDir(g.paths.workers, "t1"), "token"), "utf8")).toBe(tok(2));
    expect(g.calls.at(-1)).toBe(`DELETE /installation/token ${tok(1)}`);
  });

  test("refused, with nothing written, when it can't be the task's repository's", async () => {
    const off = github("git@gitlab.com:mecls/shop.git");
    expect(await workerToken(off.d, "t1", off.wt)).toEqual({ refused: "the clone's origin isn't a repository on github.com" });
    const notThere = github();
    notThere.uninstall();
    expect(await workerToken(notThere.d, "t1", notThere.wt)).toEqual({ refused: "the App isn't installed on mecls/shop" });
    const noApp = github();
    chmodSync(appDir(noApp.paths), 0o755);
    expect(await workerToken(noApp.d, "t1", noApp.wt)).toEqual({ refused: "the GitHub App: ~/.local/state/kinas/github-app must be mode 700, not 755" });
    const loose = github();
    expect(await workerToken(loose.d, "t1", realpathSync(mkdtempSync(join(tmpdir(), "kinas-wt-"))))).toEqual({ refused: "the worker's folder isn't a worktree of a Firstmate project" });
    for (const g of [off, notThere, noApp, loose]) expect(existsSync(tokenDir(g.paths.workers, "t1"))).toBe(false);
  });

  test("a token folder that is a link is refused, never written through", async () => {
    const g = github();
    const elsewhere = mkdtempSync(join(tmpdir(), "kinas-elsewhere-"));
    symlinkSync(elsewhere, tokenDir(g.paths.workers, "t1"));
    expect(await workerToken(g.d, "t1", g.wt)).toEqual({ refused: "the worker's token can't be written" });
    expect(existsSync(join(elsewhere, "token"))).toBe(false);
  });
});

describe("tokens on each reading", () => {
  const log: string[] = [];
  const say = (l: string) => log.push(l);

  test("renewed with 15 minutes or less left while the task is listed, and the old one ended", async () => {
    const g = github();
    await workerToken(g.d, "t1", g.wt);
    g.at(NOW + 44 * 60_000);
    await tendTokens(g.d, [{ id: "t1" }], new Set(["t1"]), say);
    expect(readFileSync(join(tokenDir(g.paths.workers, "t1"), "token"), "utf8")).toBe(tok(1));
    g.at(NOW + 46 * 60_000);
    await tendTokens(g.d, [{ id: "t1" }], new Set(["t1"]), say);
    expect(readFileSync(join(tokenDir(g.paths.workers, "t1"), "token"), "utf8")).toBe(tok(2));
    expect(readGithubRecord(githubFile(g.paths.workers, "t1"))?.expires_at).toBe(NOW + 46 * 60_000 + HOUR);
    expect(g.calls.at(-1)).toBe(`DELETE /installation/token ${tok(1)}`);
    // A task no longer listed is not renewed: its token runs out.
    g.at(NOW + 46 * 60_000 + 50 * 60_000);
    await tendTokens(g.d, [], new Set(), say);
    expect(readFileSync(join(tokenDir(g.paths.workers, "t1"), "token"), "utf8")).toBe(tok(2));
  });

  test("done or dropped: revoked and its token file gone at once; its folders once no process of the task is left", async () => {
    const g = github();
    await workerToken(g.d, "t1", g.wt);
    const tmp = workerTmp(g.paths.tmp, "t1");
    mkdirSync(tmp, { mode: 0o700 });
    const dir = tokenDir(g.paths.workers, "t1");
    await tendTokens(g.d, [{ id: "t1", ended: true }], new Set(["t1"]), say);
    expect(g.calls.at(-1)).toBe(`DELETE /installation/token ${tok(1)}`);
    expect(existsSync(join(dir, "token"))).toBe(false);
    expect(existsSync(join(dir, "gh"))).toBe(false);
    expect(readGithubRecord(githubFile(g.paths.workers, "t1"))?.ended_at).toBe(NOW);
    // Its worker still running: the folders stay, so the runtime check doesn't turn red.
    await tendTokens(g.d, [{ id: "t1", ended: true }], new Set(["t1"]), say);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(tmp)).toBe(true);
    // Gone: so are they.
    await tendTokens(g.d, [{ id: "t1", ended: true }], new Set(), say);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(githubFile(g.paths.workers, "t1"))).toBe(false);
    expect(log.some((l) => l.includes("ghs_"))).toBe(false);
  });

  test("a temp folder that is a link is left, and nothing it points at is touched", async () => {
    const g = github();
    await workerToken(g.d, "t1", g.wt);
    const elsewhere = mkdtempSync(join(tmpdir(), "kinas-elsewhere-"));
    writeFileSync(join(elsewhere, "keep"), "x");
    symlinkSync(elsewhere, workerTmp(g.paths.tmp, "t1"));
    await tendTokens(g.d, [{ id: "t1", ended: true }], new Set(), say);
    await tendTokens(g.d, [{ id: "t1", ended: true }], new Set(), say);
    expect(readFileSync(join(elsewhere, "keep"), "utf8")).toBe("x");
  });
});
