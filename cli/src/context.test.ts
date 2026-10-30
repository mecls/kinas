import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_HEADINGS } from "@kinas/context";
import { makeWorld, type World, type WorldOptions } from "@kinas/context/testing";

// `kinas`, `kinas context` and `kinas open` end to end: a whole operation on disk, the CLI run as a process. Spawned
// asynchronously, because the fake Herdr socket answers from this process.

const MAIN = join(import.meta.dir, "main.ts");
let world: World | null = null;
afterEach(async () => {
  await world?.cleanup();
  world = null;
});

async function start(opts?: WorldOptions): Promise<World> {
  world = await makeWorld(opts);
  return world;
}

async function kinas(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

/** The agent packet cut at its headings, with every time stamp and age blanked. */
function sections(md: string): Map<string, string> {
  const normal = md
    .replace(/^- Generated: .*$/m, "- Generated: T")
    .replace(/\((just now|\d+[mhdw] ago)\)/g, "(AGE)")
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "T");
  const out = new Map<string, string>();
  const lines = normal.split("\n");
  let current = "";
  for (const line of lines) {
    if ((AGENT_HEADINGS as readonly string[]).includes(line)) current = line;
    out.set(current, `${out.get(current) ?? ""}${line}\n`);
  }
  return out;
}

async function packetAfterRefresh(w: World) {
  const refresh = await kinas(["context", "--refresh"], w.env);
  expect(refresh).toMatchObject({ code: 0, stdout: "" });
  const agent = await kinas(["context", "--agent"], w.env);
  expect(agent.code).toBe(0);
  return sections(agent.stdout);
}

function onlyChanged(before: Map<string, string>, after: Map<string, string>, heading: string) {
  expect([...after.keys()]).toEqual([...AGENT_HEADINGS]);
  for (const h of AGENT_HEADINGS) {
    if (h === heading) expect(after.get(h)).not.toBe(before.get(h));
    else expect([h, after.get(h)]).toEqual([h, before.get(h)]);
  }
}

describe("kinas context", () => {
  test("--agent prints the whole packet; the operator view prints counts, decisions and recent", async () => {
    const w = await start();
    const agent = await kinas(["context", "--agent"], w.env);
    expect(agent.code).toBe(0);
    expect([...sections(agent.stdout).keys()]).toEqual([...AGENT_HEADINGS]);

    const operator = await kinas(["context"], w.env);
    expect(operator.code).toBe(0);
    expect(operator.stdout).toStartWith("Acme Ops · operations  2 projects · 2 sessions · 1 decision\n\nDecisions\n  ▲ Pick a payments provider");
    expect(operator.stdout).toContain("\nRecent\n");
    expect(operator.stdout).not.toContain("## ");
  });

  test("killing Herdr turns Sessions into one line and changes no other section", async () => {
    const w = await start();
    const before = await packetAfterRefresh(w);
    await w.herdr.stop();
    const after = await packetAfterRefresh(w);
    onlyChanged(before, after, "## Sessions");
    expect(after.get("## Sessions")).toBe("## Sessions\n\n_Unavailable: herdr: not running._\n\n");
  });

  test("removing Firstmate's state turns Crew into one line and changes no other section", async () => {
    const w = await start({ holds: false });
    const before = await packetAfterRefresh(w);
    rmSync(join(w.fmHome, "data"), { recursive: true, force: true });
    rmSync(join(w.fmHome, "state"), { recursive: true, force: true });
    const after = await packetAfterRefresh(w);
    onlyChanged(before, after, "## Crew");
    expect(after.get("## Crew")).toBe(`## Crew\n\n_Unavailable: firstmate: no fleet state yet in ${w.fmHome}._\n\n`);
  });

  test("a provider reading gone old (the network is down) marks that quota stale and changes no other section", async () => {
    const fresh = await start();
    const before = await packetAfterRefresh(fresh);
    await fresh.cleanup();
    world = null;

    const offline = await start({ ollamaAgeMs: 40 * 60_000 });
    const after = await packetAfterRefresh(offline);
    // Two worlds, two temp paths: compare with the paths blanked.
    const blank = (m: Map<string, string>, w: World) => new Map([...m].map(([k, v]) => [k, v.replaceAll(w.base, "BASE")]));
    onlyChanged(blank(before, fresh), blank(after, offline), "## Quotas");
    expect(after.get("## Quotas")).toMatch(/\| Ollama \| session \| 90% \| — \| T \(AGE\) \| stale \|/);
  });

  test("--cwd prints the packet inside the projects root and nothing outside it", async () => {
    const w = await start();
    expect((await kinas(["context", "--agent", "--cwd", w.acme], w.env)).stdout).toStartWith("# Kinas context\n");
    expect(await kinas(["context", "--agent", "--cwd", "/tmp"], w.env)).toMatchObject({ code: 0, stdout: "" });
  });

  test("a packet longer than a pipe's buffer reaches a hook whole", async () => {
    // The session hooks read the CLI through a pipe. Bun's process.exit() drops what has not left the 64 KiB pipe
    // buffer yet, and five conventions of 60 KB make a packet five times that size.
    const w = await start();
    for (let i = 0; i < 5; i++) writeFileSync(join(w.hub, `conventions/con-big-${i}.md`), `# Big ${i}\n\n${"rule ".repeat(12_000)}\n`);
    // Read the way a hook does: through a pipe whose reader is slower than the CLI, so nothing the CLI dropped at exit
    // can be hidden by a reader that drained it in time.
    const slow = Bun.spawn(["sh", "-c", 'exec "$@" | { sleep 1; cat; }', "sh", process.execPath, MAIN, "context", "--agent"], { env: w.env, stdout: "pipe", stderr: "pipe" });
    const [stdout, code] = await Promise.all([new Response(slow.stdout).text(), slow.exited]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(300_000);
    expect(stdout).toContain("\n## Recent\n");
    expect(stdout.endsWith("\n")).toBe(true);
  });

  test("a config file that cannot be read is said on stderr by every command that reads it, which then runs on defaults", async () => {
    const w = await start();
    writeFileSync(w.configPath, '{"org": "Acme Ops",}');
    // The defaults would point at this Mac's own folders; the variables keep every read inside the world.
    const env = { ...w.env, KINAS_ROOT: w.root, FM_HOME: w.fmHome, HERDR_SOCKET_PATH: w.herdr.socket, CODEX_HOME: w.codexHome, PI_CODING_AGENT_DIR: join(w.base, "pi"), CLAUDE_CONFIG_DIR: join(w.base, "claude") };
    const warning = `kinas: ${w.configPath} could not be read (`;
    const context = await kinas(["context"], env);
    expect(context.code).toBe(0);
    expect(context.stderr.startsWith(warning), context.stderr).toBe(true);
    expect(context.stderr).toContain("using defaults");
    expect(context.stdout).toContain("SintraLabs · operations");
    const open = await kinas(["open", "clients/acme/README.md"], env);
    expect(open.code).toBe(0);
    expect(open.stderr.startsWith(warning), open.stderr).toBe(true);
    expect(open.stdout).toBe(`${realpathSync.native(join(w.acme, "README.md"))}\n`);
  });

  test("with no Kinas app, no Firstmate, no Herdr and no Codex, every section still answers in one line", async () => {
    const w = await start();
    await w.herdr.stop();
    const env = { ...w.env, KINAS_DATA_DIR: join(w.base, "never-ran"), KINAS_CONFIG: join(w.base, "bare.json") };
    writeFileSync(env.KINAS_CONFIG, JSON.stringify({ root: w.root, hub: "hub", firstmate_home: join(w.base, "nofm"), herdr_socket: join(w.base, "no.sock"), codex_home: join(w.base, "nocodex") }));
    const { code, stdout } = await kinas(["context", "--agent"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("_Unavailable: firstmate: not installed");
    expect(stdout).toContain("_Unavailable: herdr: not running._");
    expect(stdout).toContain("| Claude | — | — | — | — | not connected: the Kinas app has not run yet |");
    expect(stdout).toContain("| Codex | — | — | — | — | not connected: no Codex folder on this Mac |");
  });
});

describe("kinas (the launch screen)", () => {
  test("renders from the cache on the second run, within 100 columns, and exits by itself", async () => {
    const w = await start();
    const first = await kinas([], w.env);
    expect(first.code).toBe(0);
    const second = await kinas([], w.env);
    expect(second.code).toBe(0);
    const out = second.stdout.replace(/\n$/, "").split("\n");
    expect(out.some((l) => l.includes("██╗  ██╗██╗███╗   ██╗"))).toBe(true);
    for (const l of out) expect(Bun.stringWidth(l)).toBeLessThanOrEqual(100);
    expect(out.at(-1)).toContain("2 projects · 2 sessions");
  });
});

describe("kinas open, help and usage", () => {
  test("with Kinas not running, open prints the real path (0); missing is 66, not markdown 65, nothing to reopen 66", async () => {
    const w = await start();
    const readme = realpathSync.native(join(w.acme, "README.md"));
    expect(await kinas(["open", join(w.acme, "README.md")], w.env)).toMatchObject({ code: 0, stdout: `${readme}\n` });
    expect(await kinas(["open", join(w.acme, "nope.md")], w.env)).toMatchObject({ code: 66, stdout: "" });
    // A .ts file is text, so it opens (R1). This is the end-to-end proof of the widening: the real CLI, a real tree.
    expect((await kinas(["open", join(w.acme, "src/index.ts")], w.env)).code).toBe(0);
    expect(await kinas(["open"], w.env)).toMatchObject({ code: 66, stdout: "" });
    expect((await kinas(["open", "a.md", "b.md"], w.env)).code).toBe(64);
  });

  test("several matches with Kinas not running print every match and exit 0, newest first", async () => {
    const w = await start();
    for (const d of ["one", "two"]) mkdirSync(join(w.acme, d), { recursive: true });
    writeFileSync(join(w.acme, "one/dup.md"), "# older\n");
    writeFileSync(join(w.acme, "two/dup.md"), "# newer\n");
    utimesSync(join(w.acme, "one/dup.md"), new Date(1_000_000), new Date(1_000_000));
    utimesSync(join(w.acme, "two/dup.md"), new Date(2_000_000), new Date(2_000_000));
    const real = (p: string) => realpathSync.native(join(w.acme, p));
    expect(await kinas(["open", "dup"], w.env)).toMatchObject({ code: 0, stdout: `${real("two/dup.md")}\n${real("one/dup.md")}\n` });
  });

  test("--help names every command; unknown commands and options are 64", async () => {
    const w = await start();
    const help = await kinas(["--help"], w.env);
    expect(help.code).toBe(0);
    for (const c of ["context --agent", "status [--json]", "open [<path>]", "--anywhere", "--launch"]) expect(help.stdout).toContain(c);
    expect((await kinas(["deploy"], w.env)).code).toBe(64);
    expect((await kinas(["context", "--bogus"], w.env)).code).toBe(64);
  });
});
