// Tests only: a whole operation on disk — a projects root with a hub and a client repo, a Firstmate home whose
// snapshot script prints a synthetic fleet, a fake Herdr socket, Codex logs, and an app store built from the real
// migrations — so every source reads real files through its real code path.

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dir, "../../../..");

export function fixture(name: string): string {
  return readFileSync(join(REPO, "fixtures", name), "utf8");
}

export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export function git(cwd: string, ...args: string[]): string {
  return gitWith({}, cwd, args);
}

/** A commit at a chosen time: git keeps whole seconds, so commits made in one test run would otherwise tie. */
export function commitAt(cwd: string, message: string, at: number): string {
  const date = `@${Math.floor(at / 1000)} +0000`;
  return gitWith({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, cwd, ["commit", "-q", "-m", message]);
}

function gitWith(extra: Record<string, string>, cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...GIT_ENV, ...extra } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A Herdr socket that answers every request with the same snapshot, or never answers when `silent`. */
export class FakeHerdr {
  private server: Server | null = null;
  silent = false;

  constructor(
    readonly socket: string,
    public answer: string,
  ) {}

  async start(): Promise<void> {
    rmSync(this.socket, { force: true });
    const server = createServer((conn) => {
      conn.setEncoding("utf8");
      let buffer = "";
      conn.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.includes("\n") && !this.silent) conn.end(`${this.answer.replace(/\n/g, "")}\n`);
      });
      conn.on("error", () => {});
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(this.socket, resolve));
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.socket, { force: true });
  }
}

export interface WorldOptions {
  /** Keep the captain hold on t-102 in the fleet snapshot (default true). */
  holds?: boolean;
  /** How old the Ollama reading in the store is (default one minute). */
  ollamaAgeMs?: number;
}

export interface World {
  base: string;
  root: string;
  hub: string;
  acme: string;
  fmHome: string;
  codexHome: string;
  dataDir: string;
  configPath: string;
  herdr: FakeHerdr;
  /** The environment a `kinas` process in this world runs with. */
  env: Record<string, string>;
  now: number;
  cleanup(): Promise<void>;
}

function buildStore(dir: string, now: number, opts: WorldOptions): void {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "kinas.sqlite"), { create: true });
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const migrations = join(REPO, "migrations");
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, f), "utf8"));
    db.run("INSERT INTO schema_migrations VALUES (?, 0)", [Number(f.slice(0, 4))]);
  }
  db.exec("INSERT INTO orgs VALUES ('org-1', 'default', 0)");
  db.run("INSERT INTO reader_status VALUES ('org-1', 'claude-plan', 'ok', ?, ?, NULL, 1800000, 43200000)", [now, now]);
  db.run("INSERT INTO reader_status VALUES ('org-1', 'ollama-cloud', 'ok', ?, ?, NULL, 600000, 43200000)", [now, now]);
  const quota = `INSERT INTO quotas (org_id, subscription, "window", used_pct, resets_at, plan, source, updated_at) VALUES ('org-1', ?, ?, ?, ?, NULL, ?, ?)`;
  db.run(quota, ["claude-plan", "session", 40, now + 2 * 3_600_000, "Claude Code status line", now - 60_000]);
  db.run(quota, ["ollama-cloud", "session", 10, null, "ollama.com/api/usage", now - (opts.ollamaAgeMs ?? 60_000)]);
  db.close();
}

export async function makeWorld(opts: WorldOptions = {}): Promise<World> {
  const now = Date.now();
  const base = mkdtempSync(join(tmpdir(), "kinas-w-"));
  const root = join(base, "root");

  const hub = join(root, "hub");
  write(join(hub, "AGENTS.md"), "# Org rules\n\nEvery change ships with a test.\n\n## Crew\n\nBriefs start on the rails.\n\n```md\n# not a heading\n```\n");
  write(join(hub, "conventions/con-commits.md"), "# Commits\n\nSay why, not what.\n");
  git(hub, "init", "-q", "-b", "main");
  git(hub, "add", ".");
  commitAt(hub, "Hub rules", now - 2 * 3_600_000);

  const acme = join(root, "clients/acme");
  write(join(acme, "README.md"), "# Acme storefront\n");
  write(join(acme, "docs/plan.md"), "---\ntitle: ignored\n---\n# Launch plan\n");
  write(join(acme, "src/spec-auth.md"), "# Auth spec\n");
  write(join(acme, "src/index.ts"), "export {};\n");
  write(join(acme, "notes.md"), "# Not an artifact\n");
  git(acme, "init", "-q", "-b", "main");
  git(acme, "add", ".");
  commitAt(acme, "Storefront skeleton", now - 3_600_000);
  write(join(acme, "src/index.ts"), "export const ready = true;\n");
  write(join(acme, "scratch.txt"), "wip\n");
  // A repository inside node_modules is not a project.
  write(join(acme, "node_modules/dep/.git/HEAD"), "ref: refs/heads/main\n");

  const fmHome = join(base, "firstmate");
  write(join(fmHome, "bin/fm-fleet-snapshot.sh"), '#!/bin/sh\ncat "$FM_HOME/snapshot.json"\n');
  chmodSync(join(fmHome, "bin/fm-fleet-snapshot.sh"), 0o755);
  write(join(fmHome, "data/backlog.md"), "## In flight\n");
  mkdirSync(join(fmHome, "state"), { recursive: true });
  write(join(fmHome, "data/t-095/report.md"), "# Payments providers compared\n\nStripe wins on setup time.\n");
  const snapshot = JSON.parse(fixture("firstmate-fleet-snapshot.synthetic.json").replaceAll("__FM_HOME__", fmHome).replaceAll("__ROOT__", root));
  if (opts.holds === false) snapshot.backlog.records = snapshot.backlog.records.filter((r: { captain_actionable?: boolean }) => r.captain_actionable !== true);
  write(join(fmHome, "snapshot.json"), JSON.stringify(snapshot));

  const codexHome = join(base, "codex");
  const limits = {
    primary: { used_percent: 30, window_minutes: 300, resets_at: Math.floor((now + 3_600_000) / 1000) },
    secondary: { used_percent: 12.5, window_minutes: 10080, resets_at: Math.floor((now + 3 * 86_400_000) / 1000) },
  };
  write(
    join(codexHome, "sessions/2026/09/14/rollout-2026-09-14T20-00-00-abc.jsonl"),
    `${JSON.stringify({ timestamp: new Date(now - 120_000).toISOString(), type: "event_msg", payload: { type: "token_count", rate_limits: limits } })}\n`,
  );

  const dataDir = join(base, "data");
  buildStore(dataDir, now, opts);

  const herdr = new FakeHerdr(join(base, "herdr.sock"), fixture("herdr-snapshot.synthetic.json").replaceAll("__ROOT__", root));
  await herdr.start();

  const configPath = join(base, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      org: "Acme Ops",
      instance: "operations",
      root,
      hub: "hub",
      firstmate_home: fmHome,
      herdr_socket: herdr.socket,
      codex_home: codexHome,
      pi_agent_dir: join(base, "pi"),
      claude_dir: join(base, "claude"),
    }),
  );

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(FM_HOME|HERDR_|CODEX_HOME|KINAS_|PI_CODING_AGENT_DIR|CLAUDE_CONFIG_DIR|FORCE_COLOR|NO_COLOR)/.test(k)) env[k] = v;
  }
  Object.assign(env, { KINAS_CONFIG: configPath, KINAS_DATA_DIR: dataDir, NO_COLOR: "1" });

  return {
    base,
    root,
    hub,
    acme,
    fmHome,
    codexHome,
    dataDir,
    configPath,
    herdr,
    env,
    now,
    async cleanup() {
      await herdr.stop();
      rmSync(base, { recursive: true, force: true });
    },
  };
}
