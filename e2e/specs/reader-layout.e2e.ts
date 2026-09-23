import { browser, expect } from "@wdio/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";

// The reader's layout, Part 1 (tasks/reader-layout/prd.md §5): Files and Contents are header buttons at every width;
// wide, Contents hides and shows the side column, and the choice is stored in `reader_side` and kept for the next
// file. The reader is expanded, so it is wider than 640 px in the e2e window. Every read and click is one script in
// the page — each WebDriver element lookup costs seconds under this driver.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const db = join(process.env.KINAS_DATA_DIR!, "kinas.sqlite");

const sql = (query: string) => execFileSync("/usr/bin/sqlite3", [db, query], { encoding: "utf8" }).trim();
/** The stored `reader_side`, or null while no gesture has stored one. */
const storedSide = () => {
  const value = sql("SELECT value FROM settings WHERE key = 'reader_side'");
  return value ? (JSON.parse(value) as { contents: boolean; files: boolean; width: number }) : null;
};

function kinasOpen(...args: string[]) {
  return spawnSync(CLI, ["open", ...args], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 }).status;
}

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/** `waitInPage` with one value from the spec: the condition runs in the page, where a closure variable does not exist. */
async function waitInPageWith(condition: (arg: string) => boolean, arg: string, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition, arg), { timeout, interval: 250, timeoutMsg });
}

/** Rendered, and measured: Contents is offered only once the reader knows the document is taller than itself. */
const opened = (name: string) =>
  waitInPageWith(
    (suffix: string) =>
      (document.querySelector(".reader-path")?.textContent ?? "").endsWith(suffix) &&
      document.querySelector(".reader-doc[data-rendered]") !== null &&
      document.querySelector('.reader-head button[aria-label="Contents"]') !== null,
    name,
    `${name} never finished rendering with Contents offered`,
  );

const clickLabelled = (label: string) => browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)!.click(), label);

const contentsState = () =>
  browser.execute(() => {
    const button = document.querySelector('.reader-head button[aria-label="Contents"]');
    const side = document.querySelector("aside.reader .reader-side");
    return {
      button: button ? { pressed: button.getAttribute("aria-pressed"), title: button.getAttribute("title") } : null,
      side: side ? { overlay: side.hasAttribute("data-overlay"), contents: side.querySelector(".reader-contents") !== null } : null,
    };
  });

describe("the reader's side column", () => {
  let pid = 0;

  before(async () => {
    await waitForShell();
    expect(kinasOpen("long.md")).toBe(0);
    await opened("long.md");
    await clickLabelled("Expand");
    await waitInPage(() => document.querySelector<HTMLElement>(".shell")!.dataset.panel === "expanded", "the panel never expanded");
    pid = await hook<number>("ptyPid");
  });

  it("wide, Contents is a header button, pressed, and its list sits beside the text", async () => {
    await waitInPage(() => document.querySelector("aside.reader")!.getBoundingClientRect().width >= 640, "the expanded reader is not wide");
    expect(await contentsState()).toEqual({ button: { pressed: "true", title: "Hide Contents" }, side: { overlay: false, contents: true } });
    // Nothing is stored until a gesture stores it: the column is the default.
    expect(storedSide()).toBeNull();
  });

  it("a click on Contents hides the column, releases the button, and stores the choice", async () => {
    await clickLabelled("Contents");
    await waitInPage(() => document.querySelector("aside.reader .reader-side") === null, "the side column never went");
    expect(await contentsState()).toEqual({ button: { pressed: "false", title: "Show Contents" }, side: null });
    await browser.waitUntil(async () => storedSide() !== null, { timeout: 10000, interval: 250, timeoutMsg: "reader_side was never stored" });
    expect(storedSide()).toEqual({ contents: false, files: true, width: 220 });
  });

  it("the next file opens with Contents still hidden", async () => {
    expect(kinasOpen("second.md")).toBe(0);
    await opened("second.md");
    expect(await contentsState()).toEqual({ button: { pressed: "false", title: "Show Contents" }, side: null });
    expect(storedSide()).toEqual({ contents: false, files: true, width: 220 });
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
