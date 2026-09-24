import { browser, $, expect } from "@wdio/globals";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";

// The reader's tabs (tasks/reader-layout/prd.md §5, Part 2): every file the reader shows has a tab, in the order it
// was first opened; a click shows a tab where it was left, through the same click door as the sidebar; a link
// followed makes a tab; `kinas open` of an open file brings its tab forward in place. A switch writes nothing the
// 200 ms open gate counts, and never takes the terminal's focus. Every read and click is one script in the page, but
// for the one real WebDriver click that proves focus stays put.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const APP_LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");
const renderedLines = () => (existsSync(APP_LOG) ? readFileSync(APP_LOG, "utf8").split("\n").filter((line) => line.includes("reader: rendered")).length : 0);

const TAB = (n: number) => `tab-${String(n).padStart(2, "0")}-9c2e.md`;
const LINKER = "linker-9c2e.md";

function kinasOpen(...args: string[]) {
  return spawnSync(CLI, ["open", ...args], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 }).status;
}

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

async function waitInPageWith(condition: (arg: string) => boolean, arg: string, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition, arg), { timeout, interval: 250, timeoutMsg });
}

const opened = (name: string) =>
  waitInPageWith(
    (suffix: string) => (document.querySelector(".reader-path")?.textContent ?? "").endsWith(suffix) && document.querySelector(".reader-doc[data-rendered]") !== null,
    name,
    `${name} never finished rendering`,
  );

/** The strip as the captain sees it: each tab's name in order, and the one selected. */
const strip = () =>
  browser.execute(() => ({
    tabs: [...document.querySelectorAll("aside.reader .ui-tabstrip .ui-tab .ui-tab-name")].map((n) => n.textContent),
    selected: document.querySelector('aside.reader .ui-tab[aria-selected="true"] .ui-tab-name')?.textContent ?? null,
  }));

const clickTab = (name: string) =>
  browser.execute((n: string) => document.querySelector<HTMLElement>(`aside.reader .ui-tab[data-path$="/${n}"]`)!.click(), name);

/** Where tab-01's 20th heading sits against the scroller's top. */
const twentieth = () =>
  browser.execute(() => {
    const scroller = document.querySelector("aside.reader .reader-scroll")!;
    const heading = document.querySelectorAll(".reader-body h1, .reader-body h2")[19];
    return heading ? Math.round(heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : Number.NaN;
  });

describe("the reader's tabs", () => {
  let pid = 0;

  before(async () => {
    await waitForShell();
    // Home is the first page; the terminal lives on Work, and a hidden terminal cannot hold the keys.
    await browser.keys(["Meta", "2"]);
    await waitInPage(() => document.querySelector<HTMLElement>('section[data-page="work"]')?.hidden === false, "⌘2 never showed the Work page");
    pid = await hook<number>("ptyPid");
  });

  it("kinas open three files: three tabs, in that order, the third showing", async () => {
    await hook("focusTerminal");
    for (const name of [TAB(1), LINKER, TAB(2)]) {
      expect(kinasOpen(name)).toBe(0);
      await opened(name);
    }
    expect(await strip()).toEqual({ tabs: [TAB(1), LINKER, TAB(2)], selected: TAB(2) });
  });

  it("a tab shows where it was left: scrolled to its 20th heading, switched away and back", async () => {
    await clickTab(TAB(1));
    await opened(TAB(1));
    expect((await strip()).selected).toBe(TAB(1));
    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>("aside.reader .reader-scroll")!;
      const heading = document.querySelectorAll(".reader-body h1, .reader-body h2")[19]!;
      scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(Math.abs(await twentieth())).toBeLessThanOrEqual(1);

    await clickTab(LINKER);
    await opened(LINKER);
    await clickTab(TAB(1));
    await opened(TAB(1));
    await browser
      .waitUntil(async () => Math.abs(await twentieth()) <= 24, { timeout: 10000, interval: 250 })
      .catch(async () => {
        throw new Error(`tab-01's 20th heading is ${await twentieth()} px from the top, not within 24`);
      });
    expect(await strip()).toEqual({ tabs: [TAB(1), LINKER, TAB(2)], selected: TAB(1) });
  });

  it("a link followed from the second file opens a fourth tab, showing", async () => {
    await clickTab(LINKER);
    await opened(LINKER);
    await browser.execute((n: string) => document.querySelector<HTMLAnchorElement>(`.reader-body a[href="${n}"]`)!.click(), TAB(4));
    await opened(TAB(4));
    expect(await strip()).toEqual({ tabs: [TAB(1), LINKER, TAB(2), TAB(4)], selected: TAB(4) });
  });

  it("kinas open of a file that has a tab brings it forward in its place", async () => {
    expect(kinasOpen(TAB(1))).toBe(0);
    await opened(TAB(1));
    expect(await strip()).toEqual({ tabs: [TAB(1), LINKER, TAB(2), TAB(4)], selected: TAB(1) });
  });

  it("switching tabs adds no line the open gate counts, and never takes the terminal's focus", async () => {
    await hook("focusTerminal");
    // Whatever the last `kinas open` logged has landed before counting.
    await browser.pause(750);
    const before = renderedLines();

    expect(await hook<boolean>("terminalFocused")).toBe(true);
    // The driver's click: this driver clicks in script and then calls focus() on what it clicked. A tab is not
    // focusable, so even that leaves the keys with the terminal.
    await $(`aside.reader .ui-tab[data-path$="/${TAB(2)}"]`).click();
    await opened(TAB(2));
    await clickTab(LINKER);
    await opened(LINKER);
    await clickTab(TAB(4));
    await opened(TAB(4));

    await browser.pause(750);
    expect(renderedLines()).toBe(before);
    expect(await hook<boolean>("terminalFocused")).toBe(true);
    expect((await strip()).selected).toBe(TAB(4));
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
