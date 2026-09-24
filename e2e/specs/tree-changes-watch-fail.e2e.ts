import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { waitForShell } from "../helpers.ts";
import { TOKEN } from "./tree-changes.setup.ts";

// Tree changes when the watch cannot start (build spec AC-5, the watch half; PRD §3): the tree lists as today, without
// marks, and says so under its head. A Refresh tries again — and here is refused again.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const README = join(root, "repo", `README-${TOKEN}.md`);

const files = () =>
  browser.execute(() => ({
    listed: [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-item")].map((b) => b.title),
    caption: document.querySelector(".sidebar .reader-files .tree-since")?.textContent ?? null,
  }));

describe("Tree changes, with the watch refused", () => {
  before(async () => {
    await waitForShell();
  });

  it("the tree still lists, and the caption says it is not following changes; a Refresh does not change that", async () => {
    expect(spawnSync(CLI, ["open", "repo"], { cwd: root, env: process.env, timeout: 20000 }).status).toBe(0);
    await browser.waitUntil(async () => (await files()).caption !== null, { timeout: 20000, timeoutMsg: `no caption: ${JSON.stringify(await files())}` });
    expect(await files()).toMatchObject({ caption: "Not following changes in repo" });
    expect((await files()).listed).toContain(README);

    await browser.execute(() => document.querySelector<HTMLButtonElement>(".sidebar .reader-files .tree-refresh")!.click());
    await browser.pause(1000);
    expect((await files()).caption).toBe("Not following changes in repo");
  });
});
