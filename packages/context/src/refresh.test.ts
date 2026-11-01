import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { write } from "./testing/world.ts";

const base = mkdtempSync(join(tmpdir(), "kinas-refresh-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a Pi or Claude Code settings.json that is not a regular file is never opened: no harness or model, and no wait", () => {
  // The packet's header reads Pi's settings.json on every refresh, and Claude Code's for the model. Both are a harness's
  // own folder, which its agents write; a FIFO there never answered, synchronously — no deadline could end it — so
  // `kinas context`, every refresh and every session hook hung with it. Run in a child, so the failure is a timeout.
  const pi = join(base, "pi-9c2e");
  const claude = join(base, "claude-9c2e");
  mkdirSync(pi, { recursive: true });
  mkdirSync(claude, { recursive: true });
  expect(Bun.spawnSync(["mkfifo", join(pi, "settings.json")]).exitCode).toBe(0);
  expect(Bun.spawnSync(["mkfifo", join(claude, "settings.json")]).exitCode).toBe(0);
  const empty = join(base, "empty-9c2e");
  write(join(base, "pi-ok-9c2e", "settings.json"), JSON.stringify({ defaultProvider: "p-9c2e", defaultModel: "m-9c2e" }));
  const code = `const { harnessAndModel } = await import(${JSON.stringify(join(import.meta.dir, "refresh.ts"))});
    const sessions = { state: "unavailable", note: "herdr: not running", at: 0, data: null };
    const config = (harness, piAgentDir, claudeDir) => ({ harness, model: null, piAgentDir, claudeDir });
    process.stdout.write(JSON.stringify([
      harnessAndModel(config(null, ${JSON.stringify(pi)}, ${JSON.stringify(empty)}), sessions),
      harnessAndModel(config("claude", ${JSON.stringify(empty)}, ${JSON.stringify(claude)}), sessions),
      harnessAndModel(config(null, ${JSON.stringify(join(base, "pi-ok-9c2e"))}, ${JSON.stringify(empty)}), sessions),
    ]));`;
  const child = Bun.spawnSync([process.execPath, "-e", code], { timeout: 15_000, killSignal: "SIGKILL" });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual([
    { harness: null, model: null },
    { harness: "claude", model: null },
    { harness: "pi", model: "p-9c2e/m-9c2e" },
  ]);
}, 30_000);
