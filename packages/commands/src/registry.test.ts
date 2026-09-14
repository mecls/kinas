import { describe, expect, test } from "bun:test";
import { cliCommand, commands, commandsFor, paletteMatches } from "./registry.ts";

describe("the Build 1 registry (R36)", () => {
  test("holds exactly these commands and doors", () => {
    expect(commands.map((c) => [c.id, [...c.doors]])).toEqual([
      ["status", ["cli", "palette"]],
      ["refresh", ["palette"]],
      ["go.usage", ["palette"]],
      ["go.work", ["palette"]],
      ["settings", ["palette"]],
    ]);
  });

  test("has no open command, not even a stub", () => {
    expect(commands.some((c) => c.id.includes("open") || c.cliName === "open")).toBe(false);
    expect(cliCommand("open")).toBeUndefined();
  });

  test("the CLI door is status only", () => {
    expect(commandsFor("cli").map((c) => c.cliName)).toEqual(["status"]);
    expect(cliCommand("refresh")).toBeUndefined();
  });

  test("palette filtering by title", () => {
    expect(paletteMatches("").map((c) => c.id)).toEqual(["status", "refresh", "go.usage", "go.work", "settings"]);
    expect(paletteMatches("go to").map((c) => c.id)).toEqual(["go.usage", "go.work"]);
    expect(paletteMatches("REFR").map((c) => c.id)).toEqual(["refresh"]);
    expect(paletteMatches("nothing like this")).toEqual([]);
  });

  test("a command whose context is missing says so", async () => {
    await expect(commands.find((c) => c.id === "refresh")!.run({ now: 0 })).rejects.toThrow("refresh is not available here");
  });
});
