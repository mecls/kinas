import { browser, $, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";

// The window's title bar (tasks/reader-layout/prd.md §5, Part 3; build spec AC-7): Kinas draws it, one bar across the
// window above the columns; its sidebar button is ⌘S by click; ← and → start with nowhere to go. Dragging the bar and
// double-clicking it are the captain's to check (docs/smoke-test.md): a script cannot hold the mouse down on a window.
// Reads are one script in the page; the sidebar button takes the driver's own click, which proves the driver can
// click inside the bar (the build spec's stop rule).

const db = join(process.env.KINAS_DATA_DIR!, "kinas.sqlite");
const setting = (key: string) => execFileSync("/usr/bin/sqlite3", [db, `SELECT value FROM settings WHERE key = '${key}'`], { encoding: "utf8" }).trim();

/** The bar as the captain sees it: where it sits, and each button's name, tooltip and whether it can act. */
const bar = () =>
  browser.execute(() => {
    const header = document.querySelector<HTMLElement>(".shell > header.ui-titlebar");
    const box = header?.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>("nav.sidebar");
    const stage = document.querySelector<HTMLElement>(".stage")!.getBoundingClientRect();
    return {
      at: box ? [Math.round(box.top), Math.round(box.left), Math.round(box.width), Math.round(box.height)] : null,
      window: window.innerWidth,
      below: [sidebar && !sidebar.hidden ? Math.round(sidebar.getBoundingClientRect().top) : null, Math.round(stage.top)],
      deep: header?.getAttribute("data-tauri-drag-region") ?? null,
      dragButtons: header ? header.querySelectorAll("button[data-tauri-drag-region], [data-tauri-drag-region] [data-tauri-drag-region]").length : -1,
      buttons: [...(header?.querySelectorAll("button") ?? [])].map((b) => [b.getAttribute("aria-label"), b.title, b.getAttribute("aria-disabled") === "true"]),
    };
  });

describe("the window's title bar", () => {
  let pid = 0;

  before(async () => {
    await waitForShell();
    pid = await hook<number>("ptyPid");
  });

  it("AC-7: spans the window above the columns, and ← and → start with nowhere to go, saying so", async () => {
    const b = await bar();
    // Top left, the window's width, 32 px (--chrome-h); the sidebar and the stage start under it.
    expect(b.at).toEqual([0, 0, b.window, 32]);
    expect(b.below).toEqual([32, 32]);
    // Every pixel but a button drags: the header is the region, deep, and no button carries the attribute.
    expect(b.deep).toBe("deep");
    expect(b.dragButtons).toBe(0);
    expect(b.buttons).toEqual([
      ["Hide the sidebar", "Hide the sidebar (⌘S)", false],
      ["Back", "Nothing to go back to", true],
      ["Forward", "Nothing to go forward to", true],
    ]);
    await expect($('section[data-page="home"]')).toBeDisplayed();
  });

  it("AC-7: the sidebar button hides the sidebar and brings it back, remembered as ⌘S remembers it", async () => {
    await $('.ui-titlebar button[aria-label="Hide the sidebar"]').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLElement>("nav.sidebar")?.hidden === true), { timeout: 5000, timeoutMsg: "the sidebar did not hide" });
    await browser.waitUntil(() => setting("sidebar_visible") === "false", { timeout: 5000, timeoutMsg: `sidebar_visible is ${setting("sidebar_visible")}` });
    let b = await bar();
    // The bar keeps its place and its buttons; the stage takes the window's width under it.
    expect(b.at).toEqual([0, 0, b.window, 32]);
    expect(b.below).toEqual([null, 32]);
    expect(b.buttons[0]).toEqual(["Show the sidebar", "Show the sidebar (⌘S)", false]);

    await $('.ui-titlebar button[aria-label="Show the sidebar"]').click();
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLElement>("nav.sidebar")?.hidden === false), { timeout: 5000, timeoutMsg: "the sidebar did not come back" });
    await browser.waitUntil(() => setting("sidebar_visible") === "true", { timeout: 5000, timeoutMsg: `sidebar_visible is ${setting("sidebar_visible")}` });
    b = await bar();
    expect(b.below).toEqual([32, 32]);
    expect(b.buttons[0]).toEqual(["Hide the sidebar", "Hide the sidebar (⌘S)", false]);
    // ← and → did not move.
    expect(b.buttons.slice(1).map((x) => x[2])).toEqual([true, true]);
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
