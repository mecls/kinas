import { $, browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { herdr, herdrSnapshot, hook, stopHerdrSession, waitForHook } from "../helpers.ts";

// AC-7: Open in editor splits the focused pane of the throwaway Herdr session with the editor on the file, and when
// Herdr has no focused pane it says so and types nothing into the Kinas terminal.

const SESSION = "kinas-e2e-editor";
const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);

describe("Open in editor", () => {
  before(async () => {
    await browser.keys(["Meta", "2"]);
    await waitForHook("kittyFlags", 45000);
    await browser.waitUntil(async () => (await hook<number>("kittyFlags")) > 0, { timeout: 45000, timeoutMsg: "Herdr never attached" });
  });

  after(() => stopHerdrSession(SESSION));

  it("splits the focused Herdr pane with the editor from Settings on the file", async () => {
    // `less`, so nothing has to quit an editor afterwards.
    await browser.execute(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("set_reader_editor", { value: "less" }));
    const opened = spawnSync(CLI, ["open", "other.md"], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
    expect(opened.status).toBe(0);
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".reader-doc[data-rendered]") !== null), {
      timeout: 30000,
      interval: 250,
      timeoutMsg: "other.md never finished rendering",
    });
    // A fresh session does not always hold exactly one pane (the first run found two), so compare before and after.
    const panesBefore = herdrSnapshot(SESSION).panes.length;
    console.log(`reader-editor e2e: ${panesBefore} pane(s) before Open in editor`);

    // Clicked through the page: element lookups cost about 5 s each under this driver.
    await browser.execute(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Open in editor")?.click());
    await browser.waitUntil(() => herdrSnapshot(SESSION).panes.length === panesBefore + 1, { timeout: 20000, timeoutMsg: "Herdr's pane was not split" });
    const editorPane = herdrSnapshot(SESSION).focused_pane_id;
    await browser.waitUntil(() => herdr(SESSION, "pane", "read", editorPane).includes("Other document"), {
      timeout: 20000,
      timeoutMsg: "the new pane never showed the file",
    });
  });

  it("says Herdr has no focused pane when the session is gone, and types nothing into the terminal", async () => {
    stopHerdrSession(SESSION);
    await browser.pause(1000);
    // Clicked and read through the page: the status line lasts 6 s, less than two lookups under this driver.
    await browser.execute(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Open in editor")?.click());
    await browser.waitUntil(async () => /Herdr has no focused pane; attach it first|Herdr isn't installed/.test(await hook<string>("readerStatusLog")), {
      timeout: 30000,
      timeoutMsg: "the reader never said Herdr had no focused pane",
    });
    expect(await hook<string>("terminalText")).not.toContain("less '");
  });
});
