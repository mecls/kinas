// `kinas crew setup` and `kinas crew status` (build spec §4 The CLI). Setup is crew-setup.ts; status reads the app's
// store read-only, like `kinas status` (main.ts), and exits 2 when the store does not exist, 3 when it is newer than
// this CLI, 64 on unknown usage.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { crewStatusFromStore, crewStatusJson, crewStatusLines } from "@kinas/commands";
import { HOME_DIR } from "@kinas/commands/crew-tools";
import { dataDir, openReadOnly } from "@kinas/store/sqlite-readonly";
import { terminalIo } from "./confirm.ts";
import { loginPath, setup, withoutHerdr } from "./crew-setup.ts";

const EXIT = { ok: 0, error: 1, missing: 2, newer: 3, usage: 64 } as const;

export const CREW_USAGE = [
  "  crew setup          install the crew: Firstmate at its pin and the tools, asking y/N before each",
  "    --dry-run         say what it would do and touch nothing",
  "    --yes             answer yes to every question",
  "  crew status [--json]  the crew as the app last mirrored it: counts, never a task's name",
];

function printError(message: string) {
  process.stderr.write(`${message}\n`);
}

function usageError(message: string): number {
  printError(`${message}\n\nusage: kinas crew setup [--dry-run] [--yes]\n       kinas crew status [--json]`);
  return EXIT.usage;
}

function flags(args: string[], known: string[]): { set: Set<string>; problem: string | null } {
  const set = new Set<string>();
  for (const a of args) {
    if (!known.includes(a)) return { set, problem: a.startsWith("-") ? `unknown option ${a}` : `unexpected argument ${a}` };
    set.add(a);
  }
  return { set, problem: null };
}

export async function crew(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "setup") return crewSetup(rest);
  if (sub === "status") return crewStatus(rest);
  return usageError(sub === undefined ? "kinas crew: name setup or status" : `kinas crew: unknown command "${sub}"`);
}

async function crewSetup(args: string[]): Promise<number> {
  const parsed = flags(args, ["--dry-run", "--yes"]);
  if (parsed.problem) return usageError(`kinas crew setup: ${parsed.problem}`);
  const dryRun = parsed.set.has("--dry-run");
  const yes = parsed.set.has("--yes");
  if (!dryRun && !yes && !process.stdin.isTTY) {
    printError("kinas crew setup asks before each step; run it in a terminal, or pass --yes");
    return EXIT.usage;
  }
  const env = withoutHerdr(process.env);
  if (!dryRun) env.PATH = (await loginPath(process.env)) ?? env.PATH ?? "/usr/bin:/bin";
  const io = terminalIo();
  try {
    return await setup({ dryRun, yes, home: join(dataDir(), HOME_DIR), io, env });
  } finally {
    io.close();
  }
}

async function crewStatus(args: string[]): Promise<number> {
  const parsed = flags(args, ["--json"]);
  if (parsed.problem) return usageError(`kinas crew status: ${parsed.problem}`);
  const dir = dataDir();
  const opened = openReadOnly(dir);
  if (!opened.ok) {
    if (opened.reason === "missing") {
      printError("Kinas hasn't run yet — open the app once");
      return EXIT.missing;
    }
    if (opened.reason === "newer") {
      printError("This kinas CLI is older than the app's store — the ~/.local/bin link is stale");
      return EXIT.newer;
    }
    printError(`kinas: could not read the store: ${opened.message}`);
    return EXIT.error;
  }
  try {
    const installed = existsSync(join(dir, HOME_DIR, "bin", "fm-fleet-snapshot.sh"));
    const status = crewStatusFromStore(opened.store, Date.now(), installed);
    if (parsed.set.has("--json")) process.stdout.write(`${JSON.stringify(crewStatusJson(status), null, 2)}\n`);
    else process.stdout.write(`${crewStatusLines(status).join("\n")}\n`);
    return EXIT.ok;
  } finally {
    opened.store.close();
  }
}
