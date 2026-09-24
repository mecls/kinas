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

/**
 * Drags the column's edge in the page, as reader.e2e.ts drags the divider: synthetic pointer events sent in one script,
 * released `to` px from the column's left edge (the reader's main row's left).
 */
const dragEdgeTo = (to: number) =>
  browser.execute((target: number) => {
    const edge = document.querySelector<HTMLElement>(".reader-side-edge")!;
    const main = document.querySelector<HTMLElement>("aside.reader .reader-main")!.getBoundingClientRect();
    const at = edge.getBoundingClientRect();
    const send = (type: string, x: number) =>
      edge.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: at.top + 200, pointerId: 1, button: 0, isPrimary: true }));
    const from = at.left + at.width / 2;
    const end = main.left + target;
    send("pointerdown", from);
    for (let i = 1; i <= 10; i++) send("pointermove", from + ((end - from) * i) / 10);
    send("pointerup", end);
  }, to);

/** The column as drawn, and as the edge reports it. */
const column = () =>
  browser.execute(() => ({
    width: Math.round(document.querySelector("aside.reader .reader-side")?.getBoundingClientRect().width ?? -1),
    valueNow: Number(document.querySelector(".reader-side-edge")?.getAttribute("aria-valuenow") ?? -1),
    main: Math.round(document.querySelector("aside.reader .reader-main")!.getBoundingClientRect().width),
  }));

async function waitForColumn(width: number) {
  await browser
    .waitUntil(async () => (await column()).width === width, { timeout: 10000, interval: 250 })
    .catch(async () => {
      throw new Error(`the column never became ${width} px: ${JSON.stringify(await column())}`);
    });
}

async function waitForStored(side: { contents: boolean; files: boolean; width: number }) {
  await browser
    .waitUntil(async () => JSON.stringify(storedSide()) === JSON.stringify(side), { timeout: 10000, interval: 250 })
    .catch(() => {
      throw new Error(`reader_side is ${JSON.stringify(storedSide())}, not ${JSON.stringify(side)}`);
    });
}

/** The document's width against the scroller's content box: prose fills it, with no 72ch measure (PRD rule 9). */
const fill = () =>
  browser.execute(() => {
    const scroller = document.querySelector<HTMLElement>("aside.reader .reader-scroll")!;
    const style = getComputedStyle(scroller);
    return {
      doc: Math.round(document.querySelector("aside.reader .reader-doc")!.getBoundingClientRect().width),
      content: Math.round(scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
      paddings: [style.paddingLeft, style.paddingRight],
    };
  });

/** Where long.md's 40th heading ("Section 39") sits against the scroller's top, and what Contents marks. */
const place = () =>
  browser.execute(() => {
    const scroller = document.querySelector("aside.reader .reader-scroll")!;
    const heading = [...document.querySelectorAll(".reader-body h1, .reader-body h2, .reader-body h3")][39];
    return {
      offset: heading ? Math.round(heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : Number.NaN,
      docWidth: Math.round(document.querySelector("aside.reader .reader-doc")!.getBoundingClientRect().width),
      current: document.querySelector('.reader-contents button[aria-current="true"]')?.textContent ?? null,
    };
  });

/**
 * Runs a step that changes the text's width, waits for the text to reflow, then for the 40th heading to be back
 * within one line (24 px) of the top. Waited for in the page rather than paused: the reader puts the place back when
 * its resize observer runs, which lags in a window behind others.
 */
async function keepsPlace(label: string, step: () => Promise<unknown>) {
  const before = await place();
  await step();
  await browser
    .waitUntil(async () => (await place()).docWidth !== before.docWidth, { timeout: 10000, interval: 250 })
    .catch(async () => {
      throw new Error(`${label}: the text never changed width: ${JSON.stringify(await place())}`);
    });
  await browser
    .waitUntil(async () => Math.abs((await place()).offset) <= 24, { timeout: 10000, interval: 250 })
    .catch(async () => {
      throw new Error(`${label}: the 40th heading is not within 24 px of the top: ${JSON.stringify({ before, after: await place() })}`);
    });
}

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
    // The text now has the column's room too: all of it, inside the reader's 28 px sides.
    const widths = await fill();
    expect(widths.paddings).toEqual(["28px", "28px"]);
    expect(Math.abs(widths.doc - widths.content)).toBeLessThanOrEqual(1);
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

  it("the edge drags the column 100 px wider, stores it once the drag ends, and a double-click puts back 220", async () => {
    await clickLabelled("Contents");
    await waitInPage(() => document.querySelector(".reader-side-edge") !== null, "the column's edge never showed");
    await waitForColumn(220);
    await waitForStored({ contents: true, files: true, width: 220 });

    await dragEdgeTo(320);
    await waitForColumn(320);
    expect((await column()).valueNow).toBe(320);
    await waitForStored({ contents: true, files: true, width: 320 });
    // The drag has ended: nothing is left in its dragging state.
    expect(await browser.execute(() => document.querySelector("aside.reader .reader-main")!.hasAttribute("data-dragging"))).toBe(false);

    await browser.execute(() => document.querySelector<HTMLElement>(".reader-side-edge")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await waitForColumn(220);
    await waitForStored({ contents: true, files: true, width: 220 });
  });

  it("the edge stops at 160 on the left, and on the right at 480 or where the text would get less than 320", async () => {
    await dragEdgeTo(0);
    await waitForColumn(160);
    await waitForStored({ contents: true, files: true, width: 160 });

    await dragEdgeTo(5000);
    const limit = Math.min(480, (await column()).main - 320);
    await waitForColumn(limit);
    await waitForStored({ contents: true, files: true, width: limit });
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("the 40th heading stays at the top, and stays marked, when Contents hides, across Collapse and Expand, and across ⌘S", async () => {
    expect(kinasOpen("long.md")).toBe(0);
    await opened("long.md");
    await waitInPage(() => document.querySelectorAll(".reader-contents li").length >= 40, "Contents never listed forty headings");
    await browser.execute(() => document.querySelectorAll<HTMLButtonElement>(".reader-contents li button")[39]!.click());
    const start = await place();
    expect(Math.abs(start.offset)).toBeLessThanOrEqual(1);
    expect(start.current).toBe("Section 39");

    await keepsPlace("hiding Contents", () => clickLabelled("Contents"));
    await keepsPlace("showing Contents", () => clickLabelled("Contents"));
    expect((await place()).current).toBe("Section 39");

    await keepsPlace("Collapse", () => clickLabelled("Collapse"));
    await keepsPlace("Expand", () => clickLabelled("Expand"));
    expect((await place()).current).toBe("Section 39");

    await keepsPlace("⌘S hiding the sidebar", () => browser.keys(["Meta", "s"]));
    await keepsPlace("⌘S showing the sidebar", () => browser.keys(["Meta", "s"]));
    expect((await place()).current).toBe("Section 39");
    expect(await browser.execute(() => document.querySelector<HTMLElement>(".sidebar")!.hidden)).toBe(false);
    // Prose fills the expanded reader beside the column too.
    const widths = await fill();
    expect(Math.abs(widths.doc - widths.content)).toBeLessThanOrEqual(1);
  });

  it("narrow, Contents opens over the text as before, and a click there stores nothing", async () => {
    const stored = storedSide();
    await clickLabelled("Collapse");
    await waitInPage(() => document.querySelector("aside.reader .reader-main[data-narrow]") !== null, "the collapsed reader never became narrow");
    expect(await contentsState()).toEqual({ button: { pressed: "false", title: "Contents" }, side: null });

    await clickLabelled("Contents");
    await waitInPage(() => document.querySelector("aside.reader .reader-side[data-overlay] .reader-contents") !== null, "Contents never opened over the text");
    expect(await contentsState()).toEqual({ button: { pressed: "true", title: "Contents" }, side: { overlay: true, contents: true } });
    // The overlay is 220 px whatever the wide column remembers, and has no edge to drag.
    expect(await browser.execute(() => Math.round(document.querySelector("aside.reader .reader-side")!.getBoundingClientRect().width))).toBe(220);
    expect(await browser.execute(() => document.querySelector(".reader-side-edge") === null)).toBe(true);

    await clickLabelled("Contents");
    await waitInPage(() => document.querySelector("aside.reader .reader-side") === null, "Contents never closed");
    expect(storedSide()).toEqual(stored);
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
