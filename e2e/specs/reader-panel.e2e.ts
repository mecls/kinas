import { browser, expect } from "@wdio/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hook, openReaderMenu, waitForShell } from "../helpers.ts";

// The reader as the panel on the right of the window (tasks/three-column-shell-build-spec.md AC-3 to AC-6): expanding
// it, the Rendered / Source toggle, Copy, and the ▾ menu's keys. Everything is read and clicked inside the page —
// each WebDriver element lookup costs about 5 s under this driver.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const utf8 = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
const pbpaste = () => execFileSync("/usr/bin/pbpaste", { encoding: "utf8", env: utf8 });
const pbcopy = (text: string) => void execFileSync("/usr/bin/pbcopy", { input: text, env: utf8 });

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

const opened = (name: string) =>
  waitInPageWith(
    (suffix: string) => (document.querySelector(".reader-path")?.textContent ?? "").endsWith(suffix) && document.querySelector(".reader-doc[data-rendered]") !== null,
    name,
    `${name} never finished rendering`,
  );

const panel = () => browser.execute(() => document.querySelector<HTMLElement>(".shell")!.dataset.panel ?? "");

const viewState = () =>
  browser.execute(() => ({
    rendered: document.querySelector('.reader-view button[aria-label="Rendered"]')?.getAttribute("aria-pressed") ?? "",
    source: document.querySelector('.reader-view button[aria-label="Source"]')?.getAttribute("aria-pressed") ?? "",
  }));

const clickView = (label: "Rendered" | "Source") =>
  browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`.reader-view button[aria-label="${l}"]`)!.click(), label);

const clickLabelled = (label: string) => browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`)!.click(), label);

const statusLog = () => hook<string>("readerStatusLog");

describe("the reader's panel", () => {
  let savedClipboard = "";

  before(async () => {
    await waitForShell();
    savedClipboard = pbpaste();
  });

  after(() => pbcopy(savedClipboard));

  it("AC-3: expanding gives the reader the whole stage without resizing or restarting the terminal, and gives the keys back", async () => {
    await browser.keys(["Meta", "2"]);
    await hook("focusTerminal");
    expect(kinasOpen("plan-300.md")).toBe(0);
    await opened("plan-300.md");
    // The open itself narrows the terminal; let it settle before measuring what Expand must not change.
    await browser.pause(500);
    const pid = await hook<number>("ptyPid");
    const size = await hook<{ cols: number; rows: number }>("terminalSize");
    expect(await hook<boolean>("terminalFocused")).toBe(true);

    await clickLabelled("Expand");
    await browser.waitUntil(async () => (await panel()) === "expanded", { timeout: 10000, timeoutMsg: "the panel never expanded" });
    const expanded = await browser.execute(() => {
      const stage = document.querySelector<HTMLElement>(".stage")!.getBoundingClientRect();
      const reader = document.querySelector<HTMLElement>("aside.reader")!.getBoundingClientRect();
      return {
        // Out of the layout, not covered: no box at all.
        contentBoxes: document.querySelector<HTMLElement>(".content")!.getClientRects().length,
        dividerBoxes: document.querySelector<HTMLElement>(".stage-divider")!.getClientRects().length,
        fills: Math.abs(reader.width - stage.width) <= 1,
        sidebar: !document.querySelector<HTMLElement>(".shell nav")!.hidden,
        collapseOffered: document.querySelector('button[aria-label="Collapse"]') !== null,
      };
    });
    expect(expanded).toEqual({ contentBoxes: 0, dividerBoxes: 0, fills: true, sidebar: true, collapseOffered: true });
    // The PTY heard nothing: the terminal had no box to measure, so it kept the size it had.
    expect(await hook<{ cols: number; rows: number }>("terminalSize")).toEqual(size);

    // Going to a page means wanting to see it: the Work tab collapses the panel back to the side.
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".shell nav button")].find((b) => b.textContent?.trim() === "Work")!.click());
    await browser.waitUntil(async () => (await panel()) === "open", { timeout: 10000, timeoutMsg: "the Work tab did not collapse the panel" });
    await browser.pause(500);
    expect(await hook<{ cols: number; rows: number }>("terminalSize")).toEqual(size);
    expect(await hook<number>("ptyPid")).toBe(pid);
    expect(await hook<boolean>("terminalFocused")).toBe(true);
  });

  it("AC-4: markdown shows as its source and back, and the choice is kept per kind of file", async () => {
    expect(kinasOpen("plan-300.md")).toBe(0);
    await opened("plan-300.md");
    expect(await viewState()).toEqual({ rendered: "true", source: "false" });

    await clickView("Source");
    await waitInPage(() => document.querySelector(".reader-source") !== null, "markdown never showed as source");
    const asSource = await browser.execute(() => ({
      text: document.querySelector(".reader-source")?.textContent ?? "",
      render: document.querySelector(".reader-doc")?.getAttribute("data-render") ?? "",
      contentsButton: document.querySelector('.reader-head button[aria-label="Contents"]') !== null,
      contentsRail: document.querySelector(".reader-contents") !== null,
      frontmatterCard: document.querySelector(".reader-frontmatter") !== null,
    }));
    // The file's own text: a heading is a line starting with `# `, and the frontmatter is the `---` block it is.
    expect(asSource.text).toMatch(/^# Reader fixture plan$/m);
    expect(asSource.text.startsWith("---\n")).toBe(true);
    // Rust still calls it markdown; only the view changed. Source has no headings, so nothing offers Contents.
    expect(asSource).toMatchObject({ render: "markdown", contentsButton: false, contentsRail: false, frontmatterCard: false });
    expect(await viewState()).toEqual({ rendered: "false", source: "true" });

    await clickView("Rendered");
    await waitInPage(() => document.querySelector(".reader-body h1") !== null, "markdown never rendered again");
    expect(await viewState()).toEqual({ rendered: "true", source: "false" });

    // Per kind. Markdown is left **Rendered** on purpose: had it been left in Source, one shared variable and the
    // per-kind pair would both open the next markdown file as source, and this could not tell them apart.
    expect(kinasOpen("preview.html")).toBe(0);
    await opened("preview.html");
    await clickView("Source");
    await waitInPage(() => document.querySelector(".reader-source") !== null, "the page never showed as its markup");

    expect(kinasOpen("other.md")).toBe(0);
    await opened("other.md");
    expect(await browser.execute(() => document.querySelector(".reader-source") === null && document.querySelector(".reader-body h1") !== null)).toBe(true);
    expect(await viewState()).toEqual({ rendered: "true", source: "false" });

    // Put html back the way the other specs' fixtures expect a fresh session to be.
    expect(kinasOpen("preview.html")).toBe(0);
    await opened("preview.html");
    expect(await viewState()).toEqual({ rendered: "false", source: "true" });
    await clickView("Rendered");
    await waitInPage(() => document.querySelector(".reader-preview-frame") !== null, "the page never rendered again");

    // A file with one way to be shown has no toggle at all.
    expect(kinasOpen("0008_funnel_stage.sql")).toBe(0);
    await opened("0008_funnel_stage.sql");
    expect(await browser.execute(() => document.querySelector(".reader-view"))).toBeNull();
  });

  it("AC-5: Copy puts the file's exact text on the clipboard, and says so when a file is too large", async () => {
    expect(kinasOpen("plan-300.md")).toBe(0);
    await opened("plan-300.md");
    pbcopy("not the plan");
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-copy-main")!.click());
    const plan = readFileSync(join(root, "plan-300.md"), "utf8");
    await browser.waitUntil(() => pbpaste() === plan, { timeout: 10000, timeoutMsg: "the clipboard never held the plan's text" });
    expect(await statusLog()).toContain("Copied");

    // Over the clipboard command's 1 MiB limit: nothing is copied, and the reader says why.
    // 17 500 lines of 65 bytes: 1 137 500 bytes, past the limit of 1 048 576, in lines short enough to lay out fast.
    writeFileSync(join(root, "big.txt"), `${"0123456789abcdef".repeat(4)}\n`.repeat(17_500));
    expect(kinasOpen("big.txt")).toBe(0);
    await opened("big.txt");
    await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-copy-main")!.click());
    await browser.waitUntil(async () => (await statusLog()).includes("Too large to copy (over 1 MiB)"), { timeout: 10000, timeoutMsg: "the reader never said the file was too large to copy" });
    expect(pbpaste()).toBe(plan);
  });

  it("AC-6: the open menu holds the keys, and Esc closes it without reaching the terminal or leaving Settings", async () => {
    expect(kinasOpen("plan-300.md")).toBe(0);
    await opened("plan-300.md");
    await browser.keys(["Meta", "2"]);
    await hook("focusTerminal");
    expect(await hook<boolean>("terminalFocused")).toBe(true);

    await openReaderMenu();
    const open = await browser.execute(() => {
      const active = document.activeElement;
      return {
        role: active?.getAttribute("role") ?? "",
        first: active === document.querySelector('.reader-menu [role="menuitem"]:not([aria-disabled="true"])'),
        inTerminal: active?.closest(".terminal") !== null && active?.closest(".terminal") !== undefined,
        expanded: document.querySelector('.reader-head [aria-haspopup="menu"]')?.getAttribute("aria-expanded") ?? "",
      };
    });
    expect(open).toEqual({ role: "menuitem", first: true, inTerminal: false, expanded: "true" });

    await browser.keys("Escape");
    await waitInPage(() => document.querySelector(".reader-menu") === null, "Esc did not close the menu");
    expect(await hook<boolean>("terminalFocused")).toBe(true);

    // On Settings, Esc goes back to the last page — unless it was meant for the menu.
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.shell nav button[aria-label="Settings"]')!.click());
    await waitInPage(() => !document.querySelector<HTMLElement>('section[data-page="settings"]')!.hidden, "Settings never showed");
    await openReaderMenu();
    await browser.keys("Escape");
    await waitInPage(() => document.querySelector(".reader-menu") === null, "Esc did not close the menu on Settings");
    expect(await browser.execute(() => !document.querySelector<HTMLElement>('section[data-page="settings"]')!.hidden)).toBe(true);
  });
});
