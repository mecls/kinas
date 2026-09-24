import { describe, expect, test } from "bun:test";
import { cliCommand, commands, commandsFor, paletteMatches } from "./registry.ts";

describe("the registry (R36, CLI v0)", () => {
  test("holds exactly these commands and doors", () => {
    expect(commands.map((c) => [c.id, [...c.doors]])).toEqual([
      ["status", ["cli", "palette"]],
      ["context", ["cli"]],
      ["open", ["cli"]],
      ["refresh", ["palette"]],
      ["files.refresh", ["palette"]],
      ["go.home", ["palette"]],
      ["go.usage", ["palette"]],
      ["go.work", ["palette"]],
      ["sidebar", ["palette"]],
      ["settings", ["palette"]],
    ]);
  });

  test("the CLI door is status, context and open", () => {
    expect(commandsFor("cli").map((c) => c.cliName)).toEqual(["status", "context", "open"]);
    expect(cliCommand("refresh")).toBeUndefined();
  });

  test("palette filtering by title", () => {
    expect(paletteMatches("").map((c) => c.id)).toEqual(["status", "refresh", "files.refresh", "go.home", "go.usage", "go.work", "sidebar", "settings"]);
    expect(paletteMatches("go to").map((c) => c.id)).toEqual(["go.home", "go.usage", "go.work"]);
    expect(paletteMatches("REFR").map((c) => c.id)).toEqual(["refresh", "files.refresh"]);
    expect(paletteMatches("files").map((c) => c.id)).toEqual(["files.refresh"]);
    expect(paletteMatches("sidebar").map((c) => c.id)).toEqual(["sidebar"]);
    expect(paletteMatches("nothing like this")).toEqual([]);
  });

  test("a command whose context is missing says so", async () => {
    await expect(commands.find((c) => c.id === "refresh")!.run({ now: 0 })).rejects.toThrow("refresh is not available here");
    await expect(cliCommand("context")!.run({ now: 0 })).rejects.toThrow("context is not available here");
    await expect(cliCommand("open")!.run({ now: 0 })).rejects.toThrow("open is not available here");
  });

  test("files.refresh is palette-only and says so with no folder", async () => {
    const command = commands.find((c) => c.id === "files.refresh")!;
    expect([...command.doors]).toEqual(["palette"]);
    expect(await command.run({ now: 0, refreshFiles: async () => false })).toEqual({ lines: ["No folder in Files to refresh"] });
    expect(await command.run({ now: 0, refreshFiles: async () => true })).toEqual({});
    await expect(command.run({ now: 0 })).rejects.toThrow("refreshing files is not available here");
  });

  test("context and open return what their door supplies", async () => {
    expect(await cliCommand("context")!.run({ now: 0, getContext: async () => "# Kinas context\n" })).toEqual({ text: "# Kinas context\n" });
    expect(await cliCommand("open")!.run({ now: 0, openFile: async () => ["/a/b.md"] })).toEqual({ lines: ["/a/b.md"] });
  });
});
