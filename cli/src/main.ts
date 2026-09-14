#!/usr/bin/env bun
// kinas — the CLI door to the command registry (PRD R35–R37). Reads the store read-only; never writes.
//
//   kinas status          the Usage page as text
//   kinas status --json   the same, as JSON
//
// Exit codes: 0 (even when readings are stale — staleness is data), 2 (the store does not exist yet),
// 3 (the store is newer than this CLI: the ~/.local/bin link is stale), 64 (unknown usage), 1 (other errors).

import { intro, log, outro } from "@clack/prompts";
import { cliCommand, statusFromStore, statusJson, statusLines } from "@kinas/commands";
import { dataDir, openReadOnly } from "@kinas/store/sqlite-readonly";

const EXIT = { ok: 0, error: 1, missing: 2, newer: 3, usage: 64 } as const;

function usage(): string {
  return ["usage: kinas status [--json]", "", "  status   how much of each plan is left, today's model usage, and this Mac"].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(usage());
    return EXIT.ok;
  }
  const command = cliCommand(name);
  if (!command) {
    console.error(`kinas: unknown command "${name}"\n\n${usage()}`);
    return EXIT.usage;
  }
  const json = rest.includes("--json");
  const unknown = rest.filter((a) => a !== "--json");
  if (unknown.length) {
    console.error(`kinas ${name}: unknown option ${unknown[0]}\n\n${usage()}`);
    return EXIT.usage;
  }

  const opened = openReadOnly(dataDir());
  if (!opened.ok) {
    if (opened.reason === "missing") {
      console.error("Kinas hasn't run yet — open the app once");
      return EXIT.missing;
    }
    if (opened.reason === "newer") {
      console.error("This kinas CLI is older than the app's store — the ~/.local/bin link is stale");
      return EXIT.newer;
    }
    console.error(`kinas: could not read the store: ${opened.message}`);
    return EXIT.error;
  }

  try {
    const now = Date.now();
    const { result } = await command.run({ now, getStatus: async () => statusFromStore(opened.store, now) });
    if (!result) return EXIT.ok;
    if (json) {
      console.log(JSON.stringify(statusJson(result), null, 2));
      return EXIT.ok;
    }
    const tty = Boolean(process.stdout.isTTY);
    const lines = statusLines(result, tty);
    if (tty) {
      intro("kinas status");
      log.message(lines.join("\n"));
      outro("Readings are shown with their age; stale lines are marked.");
    } else {
      console.log(lines.join("\n"));
    }
    return EXIT.ok;
  } finally {
    opened.store.close();
  }
}

process.exit(await main(process.argv.slice(2)));
