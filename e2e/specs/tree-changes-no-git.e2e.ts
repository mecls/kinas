import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForShell } from "../helpers.ts";
import { README_TEXT, TOKEN } from "./tree-changes.setup.ts";

// Tree changes with no git (build spec slice 3.3): a folder inside a repository, opened by a launch that cannot run
// git, marks as any other folder does — its baseline is copies, not blobs.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const repo = join(root, "repo");
const README = `README-${TOKEN}.md`;

const marks = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".sidebar .reader-files .tree-row")]
      .filter((row) => row.dataset.mark !== undefined || row.dataset.rollup !== undefined)
      .map((row) => `${row.querySelector<HTMLButtonElement>(".tree-item")!.title.split("/").pop()} ${row.querySelector<HTMLElement>(".ui-change-mark")?.textContent}`),
  ) as Promise<string[]>;

describe("Tree changes without git", () => {
  before(async () => {
    await waitForShell();
  });

  it("a changed file is M, a deleted one rolls up, and the file written back loses its M", async () => {
    expect(spawnSync(CLI, ["open", "repo"], { cwd: root, env: process.env, timeout: 20000 }).status).toBe(0);
    await browser.waitUntil(() => browser.execute((p: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-item")].some((b) => b.title === p), join(repo, README)), {
      timeout: 20000,
      timeoutMsg: "Files never listed repo",
    });
    await browser.pause(500);

    writeFileSync(join(repo, README), `${README_TEXT}A line.\n`);
    rmSync(join(repo, "docs", `old-${TOKEN}.md`));
    await browser.waitUntil(async () => (await marks()).length === 2, { timeout: 2000, timeoutMsg: `the marks: ${JSON.stringify(await marks())}` });
    expect(await marks()).toEqual(["docs 1", `${README} M`]);

    writeFileSync(join(repo, README), README_TEXT);
    await browser.waitUntil(async () => (await marks()).length === 1, { timeout: 2000, timeoutMsg: `the marks: ${JSON.stringify(await marks())}` });
    expect(await marks()).toEqual(["docs 1"]);
  });
});
