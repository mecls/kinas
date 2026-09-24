import { browser, $, expect } from "@wdio/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";

// The window's title bar (tasks/reader-layout/prd.md §5, Part 3; build spec AC-7): Kinas draws it, one bar across the
// window above the columns; its sidebar button is ⌘S by click; ← and → start with nowhere to go, then walk the places
// visited, pages and files alike (AC-6: the PRD's walk, read from the page). Dragging the bar and
// double-clicking it are the captain's to check (docs/smoke-test.md): a script cannot hold the mouse down on a window.
// Reads are one script in the page; the sidebar button takes the driver's own click, which proves the driver can
// click inside the bar (the build spec's stop rule).

const db = join(process.env.KINAS_DATA_DIR!, "kinas.sqlite");
const root = realpathSync(process.env.KINAS_ROOT!);
const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const kinasOpen = (name: string) => spawnSync(CLI, ["open", name], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 }).status;
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

/** The place showing, as the captain sees it: the page, and the reader's file — null while the panel is closed. */
const place = () =>
  browser.execute(() => {
    const page = document.querySelector<HTMLElement>("section.page:not([hidden])")?.dataset.page ?? null;
    const reader = document.querySelector<HTMLElement>("aside.reader");
    if (!reader || reader.hidden) return [page, null];
    const rendered = document.querySelector(".reader-doc[data-rendered]") !== null;
    return [page, rendered ? (document.querySelector(".reader-path")?.textContent ?? "") : "(opening)"];
  });

async function waitForPlace(page: string, file: string | null) {
  const at = (p: (string | null)[]) => p[0] === page && (file === null ? p[1] === null : (p[1] ?? "").endsWith(file));
  await browser.waitUntil(async () => at(await place()), { timeout: 15000, interval: 250 }).catch(async () => {
    const h = await hook<{ places: { page: string; reader: { kind: string; path?: string } }[]; at: number }>("places");
    const recorded = h.places.map((p, i) => `${i === h.at ? "→" : " "}(${p.page}, ${p.reader.kind === "none" ? "nothing" : p.reader.path})`).join(" ");
    throw new Error(`the place is ${JSON.stringify(await place())}, not ${JSON.stringify([page, file])}; recorded: ${recorded}`);
  });
}

/**
 * ← or →, clicked in the page like every other click here: the driver's own click waits on the service's focus probe
 * (about 30 s a command, build spec §19), and four of them outlast a case. The sidebar case above has already shown
 * the driver's click works inside the bar. A button that cannot act does nothing.
 */
const press = (label: "Back" | "Forward") => browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`.ui-titlebar button[aria-label="${l}"]`)!.click(), label);
/** Whether ← and → can act. */
const arrows = () =>
  browser.execute(() => ["Back", "Forward"].map((l) => document.querySelector(`.ui-titlebar button[aria-label="${l}"]`)?.getAttribute("aria-disabled") !== "true"));

const scrollTop = () => browser.execute(() => Math.round(document.querySelector<HTMLElement>("aside.reader .reader-scroll")!.scrollTop));
const strip = () => browser.execute(() => [...document.querySelectorAll("aside.reader .ui-tab .ui-tab-name")].map((n) => n.textContent));

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

  let aTop = 0;

  it("AC-6: ← walks back through pages and files, to where each file was left", async () => {
    // Home → Usage → A → B → Settings.
    await browser.keys(["Meta", "4"]);
    await waitForPlace("usage", null);
    expect(kinasOpen("place-a.md")).toBe(0);
    await waitForPlace("usage", "place-a.md");
    // A is left scrolled to its twelfth heading, so coming back has somewhere to come back to.
    aTop = await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>("aside.reader .reader-scroll")!;
      const heading = document.querySelectorAll(".reader-body h2")[11] as HTMLElement;
      scroller.scrollTop = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      return Math.round(scroller.scrollTop);
    });
    expect(aTop).toBeGreaterThan(200);
    expect(kinasOpen("place-b.md")).toBe(0);
    await waitForPlace("usage", "place-b.md");
    await browser.keys(["Meta", ","]);
    await waitForPlace("settings", "place-b.md");
    expect(await arrows()).toEqual([true, false]);

    await press("Back");
    await waitForPlace("usage", "place-b.md");
    await press("Back");
    await waitForPlace("usage", "place-a.md");
    await browser.waitUntil(async () => Math.abs((await scrollTop()) - aTop) <= 2, { timeout: 5000, timeoutMsg: "A did not come back where it was left" });
    await press("Back");
    await waitForPlace("usage", null);
    await press("Back");
    await waitForPlace("home", null);
    expect(await arrows()).toEqual([false, true]);
  });

  it("AC-6: → undoes ←, back to the file at its place", async () => {
    await press("Forward");
    await waitForPlace("usage", null);
    await press("Forward");
    await waitForPlace("usage", "place-a.md");
    await browser.waitUntil(async () => Math.abs((await scrollTop()) - aTop) <= 2, { timeout: 5000, timeoutMsg: "A did not come back where it was left" });
    expect(await arrows()).toEqual([true, true]);
  });

  it("AC-6: opening C after ← drops the places ahead, and → has nowhere to go", async () => {
    expect(kinasOpen("place-c.md")).toBe(0);
    await waitForPlace("usage", "place-c.md");
    expect(await arrows()).toEqual([true, false]);
  });

  it("a place whose tab has closed opens its file again, as a tab at the right end", async () => {
    expect(await strip()).toEqual(["place-a.md", "place-b.md", "place-c.md"]);
    await browser.execute(() => document.querySelector<HTMLButtonElement>('aside.reader .ui-tab[data-path$="/place-a.md"] .ui-tab-close')!.click());
    await browser.waitUntil(async () => JSON.stringify(await strip()) === JSON.stringify(["place-b.md", "place-c.md"]), { timeout: 5000, timeoutMsg: "A's tab did not close" });
    await waitForPlace("usage", "place-c.md");
    await press("Back");
    await waitForPlace("usage", "place-a.md");
    expect(await strip()).toEqual(["place-b.md", "place-c.md", "place-a.md"]);
  });

  it("← onto the Work page gives the terminal the keys, as ⌘2 does, and the terminal is the one it was", async () => {
    await browser.keys(["Meta", "2"]);
    await waitForPlace("work", "place-a.md");
    await browser.keys(["Meta", "1"]);
    await waitForPlace("home", "place-a.md");
    // Whatever WebKit does with the focus of a page it hides, the keys are taken from the terminal here, so it is
    // the ← that gives them back.
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await hook<boolean>("terminalFocused")).toBe(false);
    await press("Back");
    await waitForPlace("work", "place-a.md");
    await browser.waitUntil(async () => hook<boolean>("terminalFocused"), { timeout: 10000, timeoutMsg: "the terminal never got the keys" });
    expect(await hook<number>("ptyPid")).toBe(pid);
    // Every file a place ever held is this spec's own: nothing outside its projects root was shown.
    const h = await hook<{ places: { reader: { kind: string; path?: string } }[] }>("places");
    const outside = h.places.filter((p) => p.reader.kind !== "none" && !(p.reader.path ?? "").startsWith(root));
    expect(outside).toEqual([]);
  });
});
