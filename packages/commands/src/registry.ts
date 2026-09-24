// One command registry, two doors (PRD R36): the CLI and the ⌘K palette import this same list. Each door
// supplies the context its commands need; a command a door cannot run is not offered there.

import type { StatusResult } from "./status.ts";

export type Door = "cli" | "palette";

export interface CommandContext {
  now: number;
  /** Both doors: the CLI reads the store read-only, the palette asks the app. */
  getStatus?: () => Promise<StatusResult>;
  /** CLI only: the context packet, rendered for the operator or for an agent. */
  getContext?: () => Promise<string>;
  /** CLI only: the lines that point at the file being opened. */
  openFile?: () => Promise<string[]>;
  /** Palette only. */
  navigate?: (page: "home" | "usage" | "work") => void;
  refresh?: () => Promise<void>;
  /** Refreshes the tree Files shows (tree changes rule 16); false when Files shows no folder. */
  refreshFiles?: () => Promise<boolean>;
  toggleSidebar?: () => void;
  openSettings?: () => void;
}

export interface CommandOutput {
  /** Text to show: printed by the CLI, shown inside the palette. */
  lines?: string[];
  /** Preformatted text, printed as is. */
  text?: string;
  result?: StatusResult;
}

export interface Command {
  id: string;
  title: string;
  /** The CLI subcommand, when the command has a CLI door. */
  cliName?: string;
  doors: readonly Door[];
  run(ctx: CommandContext): Promise<CommandOutput>;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not available here`);
  return value;
}

export const commands: readonly Command[] = [
  {
    id: "status",
    title: "Status",
    cliName: "status",
    doors: ["cli", "palette"],
    async run(ctx) {
      const result = await need(ctx.getStatus, "status")();
      return { result };
    },
  },
  {
    // The context packet (CLI v0): `kinas context` for the operator, `--agent` for the start of an agent session.
    id: "context",
    title: "Context",
    cliName: "context",
    doors: ["cli"],
    async run(ctx) {
      return { text: await need(ctx.getContext, "context")() };
    },
  },
  {
    // Hands a file or folder to the running app's reader over its socket, and prints the resolved path
    // (tasks/prd-kinas-open.md, tasks/prd-reader-any-file.md). The reader is a panel of the window, opened by naming
    // a file rather than by going somewhere, so there is no palette door (5A).
    id: "open",
    title: "Open a file",
    cliName: "open",
    doors: ["cli"],
    async run(ctx) {
      return { lines: await need(ctx.openFile, "open")() };
    },
  },
  {
    // Writes, and the CLI is read-only (R7).
    id: "refresh",
    title: "Refresh readings",
    doors: ["palette"],
    async run(ctx) {
      await need(ctx.refresh, "refresh")();
      return {};
    },
  },
  {
    // Tree changes (rule 16): what the Files header's ↻ does, for the folder Files shows. The sidebar's actions are
    // click-only, and this is their keyboard path (keymap.md, Sidebar).
    id: "files.refresh",
    title: "Refresh files",
    doors: ["palette"],
    async run(ctx) {
      const refreshed = await need(ctx.refreshFiles, "refreshing files")();
      return refreshed ? {} : { lines: ["No folder in Files to refresh"] };
    },
  },
  {
    id: "go.home",
    title: "Go to Home",
    doors: ["palette"],
    async run(ctx) {
      need(ctx.navigate, "navigation")("home");
      return {};
    },
  },
  {
    id: "go.usage",
    title: "Go to Usage",
    doors: ["palette"],
    async run(ctx) {
      need(ctx.navigate, "navigation")("usage");
      return {};
    },
  },
  {
    id: "go.work",
    title: "Go to Work",
    doors: ["palette"],
    async run(ctx) {
      need(ctx.navigate, "navigation")("work");
      return {};
    },
  },
  {
    id: "sidebar",
    title: "Hide or show the sidebar",
    doors: ["palette"],
    async run(ctx) {
      need(ctx.toggleSidebar, "the sidebar")();
      return {};
    },
  },
  {
    id: "settings",
    title: "Settings",
    doors: ["palette"],
    async run(ctx) {
      need(ctx.openSettings, "settings")();
      return {};
    },
  },
];

export function commandsFor(door: Door): Command[] {
  return commands.filter((c) => c.doors.includes(door));
}

export function cliCommand(name: string): Command | undefined {
  return commands.find((c) => c.doors.includes("cli") && c.cliName === name);
}

export function paletteMatches(query: string): Command[] {
  const q = query.trim().toLowerCase();
  return commandsFor("palette").filter((c) => q === "" || c.title.toLowerCase().includes(q));
}

export * from "./status.ts";
