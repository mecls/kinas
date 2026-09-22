import { $, $$, browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";
// The real policy and the real attribute, imported rather than retyped: a copy here could drift from the shipped
// one and the probe would then prove nothing about what Miguel actually runs.
import { injectCsp, PREVIEW_SANDBOX } from "../../app/src/reader/preview.ts";

// `kinas open` and the reader (tasks/kinas-open-build-spec.md AC-1 to AC-6): the built CLI talks to the test app over
// the run's own socket, against fixtures/reader as the projects root.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const dataDir = process.env.KINAS_DATA_DIR!;
const root = realpathSync(process.env.KINAS_ROOT!);
const plan = join(root, "plan-300.md");

function kinas(...args: string[]) {
  const result = spawnSync(CLI, ["open", ...args], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The header's path, read in the page: a `$` lookup costs about 5 s under this driver, so polling with one is hopeless. */
const headerText = () => browser.execute(() => document.querySelector(".reader-path")?.textContent ?? "");

async function waitForHeader(suffix: string, timeout = 20000) {
  await browser.waitUntil(async () => (await headerText()).endsWith(suffix), { timeout, interval: 250, timeoutMsg: `the reader never showed ${suffix}` });
}

const scrollTop = () => browser.execute(() => document.querySelector<HTMLElement>(".reader-scroll")!.scrollTop);

/** Which of the header's two view buttons is pressed. Both empty when the file has one view and no toggle. */
const viewState = () =>
  browser.execute(() => ({
    rendered: document.querySelector('.reader-view button[aria-label="Rendered"]')?.getAttribute("aria-pressed") ?? "",
    source: document.querySelector('.reader-view button[aria-label="Source"]')?.getAttribute("aria-pressed") ?? "",
  }));

const clickView = (label: "Rendered" | "Source") =>
  browser.execute((l: string) => document.querySelector<HTMLButtonElement>(`.reader-view button[aria-label="${l}"]`)!.click(), label);

const statusLog = () => hook<string>("readerStatusLog");

/** How many opens the app has timed: the lines the 200 ms gate counts. A sidebar click must never add one. */
const APP_LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");
const renderedLines = () => (existsSync(APP_LOG) ? readFileSync(APP_LOG, "utf8").split("\n").filter((line) => line.includes("reader: rendered")).length : 0);

/**
 * Waits on a condition read inside the page. Each WebDriver element lookup costs about 5 s under this driver, and a
 * handful of them runs past mocha's 120 s per-test timeout. `condition` runs in the page, so it must be
 * self-contained.
 */
async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/**
 * `waitInPage` for a condition that needs one value from the spec, the way `hookWith` is `hook` with an argument.
 *
 * The condition is serialised and evaluated in the page, so a closure variable is simply not there: it fails at
 * runtime with `Can't find variable`, and nothing catches it earlier, because `bun run check` typechecks
 * `packages/*`, `cli` and `app` but **not** `e2e`. Pass what the condition needs.
 */
async function waitInPageWith(condition: (arg: string) => boolean, arg: string, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition, arg), { timeout, interval: 250, timeoutMsg });
}

describe("kinas open and the reader", () => {
  before(async () => {
    await waitForShell();
  });

  it("AC-1: opens a plan beside the pane without moving focus or restarting the terminal", async () => {
    await browser.keys(["Meta", "2"]);
    await hook("focusTerminal");
    const pid = await hook<number>("ptyPid");

    expect(kinas("plan-300.md")).toMatchObject({ code: 0, stdout: `${plan}\n` });
    // Page scripts and hooks only in this case: each WebDriver element lookup costs about 5 s under this driver, and
    // enough of them ran past mocha's per-test timeout.
    await browser.pause(1500);
    const focusedAfterOpen = await hook<boolean>("terminalFocused");
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".reader-doc[data-rendered]") !== null), {
      timeout: 30000,
      interval: 250,
      timeoutMsg: "the plan never finished rendering",
    });
    const page = await browser.execute(() => ({
      frontmatter: document.querySelector(".reader-frontmatter")?.textContent ?? "",
      diagram: document.querySelector(".mermaid-block svg") !== null,
      image: document.querySelector<HTMLImageElement>('img[alt="diagram"]')?.getAttribute("src") ?? "",
      contentsOffered: document.querySelector('.reader-head button[aria-label="Contents"]') !== null || document.querySelector(".reader-contents") !== null,
    }));
    expect(page.frontmatter).toContain("Reader fixture plan");
    expect(page.diagram).toBe(true);
    expect(page.image).toMatch(/^blob:/);
    // Docked beside the sidebar the reader is narrower than 640 px, so Contents is a header button, not a rail
    // (three-column shell, 2026-09-18). Offered for this document either way — and the button leads to the list.
    expect(page.contentsOffered).toBe(true);
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-head button[aria-label="Contents"]')?.click());
    await waitInPage(() => document.querySelectorAll(".reader-contents li").length >= 2, "Contents never listed the plan's headings");
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-head button[aria-label="Contents"]')?.click());
    const focusedAfterChecks = await hook<boolean>("terminalFocused");
    if (!focusedAfterOpen || !focusedAfterChecks) {
      const active = await browser.execute(() => document.activeElement?.outerHTML.slice(0, 160) ?? "none");
      throw new Error(
        `the terminal lost focus (after open: ${focusedAfterOpen}, after checks: ${focusedAfterChecks})\nactive: ${active}\n--- focus log ---\n${await hook<string>("readerFocusLog")}`,
      );
    }

    await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-close")!.click());
    await browser.waitUntil(() => browser.execute(() => document.querySelector<HTMLElement>("aside.reader")!.hidden), {
      timeout: 10000,
      interval: 250,
      timeoutMsg: "the reader did not close",
    });
    expect(await hook<number>("ptyPid")).toBe(pid);
    expect(await hook("terminalFocused")).toBe(true);
  });

  it("opens on the right of whichever page is showing, without switching to Work (three-column shell AC-1)", async () => {
    await browser.keys(["Meta", "1"]);
    await waitInPage(() => !document.querySelector<HTMLElement>('section[data-page="home"]')!.hidden, "the Home page never showed");
    const pid = await hook<number>("ptyPid");

    expect(kinas("plan-300.md").code).toBe(0);
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered]") !== null, "the plan never finished rendering");
    const layout = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>("aside.reader")!;
      const content = document.querySelector<HTMLElement>(".content")!;
      return {
        homeShowing: !document.querySelector<HTMLElement>('section[data-page="home"]')!.hidden,
        workShowing: !document.querySelector<HTMLElement>('section[data-page="work"]')!.hidden,
        panelHidden: panel.hidden,
        shell: document.querySelector<HTMLElement>(".shell")!.dataset.panel,
        panelLeft: Math.round(panel.getBoundingClientRect().left),
        panelRight: Math.round(panel.getBoundingClientRect().right),
        contentRight: Math.round(content.getBoundingClientRect().right),
        stageRight: Math.round(document.querySelector<HTMLElement>(".stage")!.getBoundingClientRect().right),
      };
    });
    // Still on Home: `kinas open` used to force the Work page, because the reader lived inside it.
    expect(layout).toMatchObject({ homeShowing: true, workShowing: false, panelHidden: false, shell: "open" });
    // On the right: the panel starts where the page ends (the divider overlaps each by 3 px) and ends at the stage's edge.
    expect(layout.panelLeft).toBeGreaterThanOrEqual(layout.contentRight - 3);
    expect(layout.panelRight).toBe(layout.stageRight);
    expect(await hook<number>("ptyPid")).toBe(pid);

    // The cases below measure the terminal beside the reader, so they run on the Work page.
    await browser.keys(["Meta", "2"]);
    await waitInPage(() => !document.querySelector<HTMLElement>('section[data-page="work"]')!.hidden, "the Work page never showed");
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("AC-3: follows a relative link to its fragment, and Back returns to the same place", async () => {
    expect(kinas("plan-300.md").code).toBe(0);
    await waitForHeader("plan-300.md");
    await $(".reader-doc[data-rendered]").waitForExist({ timeout: 15000 });
    await browser.execute(() => {
      document.querySelector<HTMLElement>(".reader-scroll")!.scrollTop = 120;
    });
    const before = await scrollTop();

    const link = await $('.reader-body a[href="other.md#part"]');
    await browser.execute((el) => (el as unknown as HTMLElement).click(), link);
    await waitForHeader("other.md");
    const fragmentView = () =>
      browser.execute(() => {
        const scroller = document.querySelector<HTMLElement>(".reader-scroll")!;
        const part = document.getElementById("part");
        return {
          exists: part !== null,
          offset: part ? Math.round(part.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : null,
          scrollTop: Math.round(scroller.scrollTop),
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          rendered: document.querySelector(".reader-doc[data-rendered]") !== null,
        };
      });
    await browser
      .waitUntil(
        async () => {
          const v = await fragmentView();
          return v.exists && v.offset !== null && v.offset >= -2 && v.offset < v.clientHeight;
        },
        { timeout: 15000, interval: 250 },
      )
      .catch(async () => {
        throw new Error(`#part is not in view: ${JSON.stringify(await fragmentView())}`);
      });

    await $('button[aria-label="Back"]').click();
    await waitForHeader("plan-300.md");
    await browser.waitUntil(async () => Math.abs((await scrollTop()) - before) <= 2, { timeout: 5000, timeoutMsg: "Back did not restore the scroll position" });
  });

  it("the divider resizes the reader against the terminal, and the width is remembered", async () => {
    // The reader is the panel on the right of the stage (three-column shell, 2026-09-18), so its share is measured
    // from the stage's right edge: a pointer released 65 % of the way across leaves the reader 35 %.
    const share = () =>
      browser.execute(() => document.querySelector<HTMLElement>("aside.reader")!.getBoundingClientRect().width / document.querySelector<HTMLElement>(".stage")!.getBoundingClientRect().width);
    const stored = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ reader_width_pct: number }> } }).__TAURI_INTERNALS__.invoke("get_ui_prefs").then((p) => p.reader_width_pct),
      );
    const cols = await hook<{ cols: number }>("terminalSize");

    await browser.execute(() => {
      const divider = document.querySelector<HTMLElement>(".stage-divider")!;
      const row = document.querySelector<HTMLElement>(".stage")!.getBoundingClientRect();
      const send = (type: string, x: number) =>
        divider.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 200, pointerId: 1, button: 0, isPrimary: true }));
      send("pointerdown", divider.getBoundingClientRect().left + 3);
      send("pointermove", row.left + row.width * 0.5);
      send("pointerup", row.left + row.width * 0.65);
    });
    // The layout facts that would explain a wrong share, read in the page like everything else here.
    const layout = () =>
      browser.execute(() => {
        const width = (selector: string) => Math.round(document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? -1);
        const panel = document.querySelector<HTMLElement>("aside.reader")!;
        return {
          window: window.innerWidth,
          stage: width(".stage"),
          content: width(".content"),
          reader: width("aside.reader"),
          flexBasis: panel.style.flexBasis,
          panel: document.querySelector<HTMLElement>(".shell")!.dataset.panel,
          sidebar: document.querySelector<HTMLElement>(".shell")!.dataset.sidebar,
          dragging: document.querySelector(".stage")!.hasAttribute("data-dragging"),
        };
      });
    await browser.waitUntil(async () => Math.abs((await share()) - 0.35) < 0.02, { timeout: 10000 }).catch(async () => {
      throw new Error(`the reader did not take 35 % of the row: share ${await share()}, ${JSON.stringify(await layout())}`);
    });
    await browser.waitUntil(async () => (await stored()) === 35, { timeout: 10000, timeoutMsg: "the width was not remembered" });
    // The terminal refits to its wider box.
    await browser.waitUntil(async () => (await hook<{ cols: number }>("terminalSize")).cols > cols.cols, { timeout: 10000, timeoutMsg: "the terminal did not refit" });

    await browser.execute(() => document.querySelector<HTMLElement>(".stage-divider")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    // 45 since the sidebar grew to 220 px; 55 beside the old 72 px rail.
    await browser.waitUntil(async () => (await stored()) === 45, { timeout: 10000, timeoutMsg: "double-click did not restore 45 %" });
  });

  it("AC-2: follows the file on disk, keeps an unchanged diagram, and survives rename and removal", async () => {
    expect(await hook("readerMarkDiagram")).toBe(true);
    const original = readFileSync(plan, "utf8");

    // Timed inside the page: under this driver each WebDriver lookup can take seconds, so polling cannot measure it.
    await browser.execute(() => {
      const w = window as unknown as { __kinasAddedAt?: number | null };
      w.__kinasAddedAt = null;
      const observer = new MutationObserver(() => {
        if (document.getElementById("added")) {
          w.__kinasAddedAt = Date.now();
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector(".reader-body")!, { childList: true, subtree: true });
    });
    const appended = Date.now();
    appendFileSync(plan, "\n## Added\n");
    await waitInPage(() => document.getElementById("added") !== null, "the appended heading never showed");
    const seenAt = await browser.execute(() => (window as unknown as { __kinasAddedAt?: number | null }).__kinasAddedAt ?? 0);
    console.log(`reader e2e: an append was on screen ${seenAt - appended} ms after the write`);
    expect(seenAt - appended).toBeLessThan(1000);
    expect(await hook("readerDiagramMarked")).toBe(true);

    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".reader-scroll")!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    for (let i = 1; i <= 20; i++) {
      appendFileSync(plan, `\n- line ${i}\n`);
      await browser.pause(300);
    }
    await browser.pause(1500);
    const gap = await browser.execute(() => {
      const s = document.querySelector<HTMLElement>(".reader-scroll")!;
      return s.scrollHeight - s.scrollTop - s.clientHeight;
    });
    expect(gap).toBeLessThanOrEqual(48);

    writeFileSync(`${plan}.tmp`, `${readFileSync(plan, "utf8")}\n## Renamed\n`);
    renameSync(`${plan}.tmp`, plan);
    await waitInPage(() => document.getElementById("renamed") !== null, "a rename over the file was not followed");

    rmSync(plan);
    await waitInPage(
      () => document.querySelector(".reader-status")?.textContent === "plan-300.md was removed; showing the last version",
      "the removal was not reported",
    );
    expect(await browser.execute(() => document.querySelector(".reader-body h1") !== null)).toBe(true);
    writeFileSync(plan, `${original}\n## Back again\n`);
    await waitInPage(() => document.getElementById("back-again") !== null, "the file written again was not reloaded");
    await waitInPage(() => document.querySelector(".reader-status") === null, "the removal notice stayed after the file came back");
  });

  it("AC-4: refuses outside the root, non-markdown and missing paths, and creates nothing", async () => {
    const outside = kinas("../outside/x.md");
    expect(outside.code).toBe(77);
    expect(outside.stderr.trim().split("\n")).toEqual([`kinas open: ${realpathSync(join(dataDir, "outside/x.md"))} is outside ${root}; add --anywhere to ask Kinas to open it`]);
    // 65 is now "not a text file": binary content, or not a regular file. `notes.txt` opens, and has its own case.
    const binary = kinas("binary.bin");
    expect(binary.code).toBe(65);
    expect(binary.stderr.trim().split("\n")).toEqual([`kinas open: ${join(root, "binary.bin")} is not a text file`]);
    expect(kinas("link-out.md").code).toBe(77);
    expect(kinas("missing.md").code).toBe(66);
    expect(existsSync(join(root, "missing.md"))).toBe(false);
    expect(await headerText()).toMatch(/plan-300\.md$/);
  });

  it("AC-5: --anywhere asks for a click, and Enter in the terminal cannot answer", async () => {
    await hook("focusTerminal");
    const asked = kinas("--anywhere", "../outside/x.md");
    expect(asked.code).toBe(0);
    expect(asked.stderr).toContain("Kinas is asking whether to open it");
    await $(".reader-confirm").waitForDisplayed({ timeout: 5000 });
    await expect($(".reader-confirm")).toHaveText(expect.stringContaining(`Open a file outside ${root}?`));
    expect(await hook("terminalFocused")).toBe(true);

    await browser.keys("Enter");
    await browser.pause(500);
    await expect($(".reader-confirm")).toBeDisplayed();
    expect(await headerText()).toMatch(/plan-300\.md$/);

    await $(".reader-confirm").$("button=Open").click();
    await waitForHeader("outside/x.md");
  });

  it("reopens the last file when kinas open is given no path", async () => {
    const reopened = kinas();
    expect(reopened).toMatchObject({ code: 0, stdout: `${realpathSync(join(dataDir, "outside/x.md"))}\n` });
    await waitForHeader("outside/x.md");
  });

  it("opens a folder in the file tree with its README selected", async () => {
    expect(kinas("docs").code).toBe(0);
    await waitForHeader("docs/README.md");
    // Read in the page, with the layout facts that would explain a missing tree. The tree lives in the sidebar
    // since 2026-09-18 (the section kept its `reader-files` class), and only comes back to the reader while the
    // sidebar is hidden.
    const tree = () =>
      browser.execute(() => ({
        selected: document.querySelector('.reader-files .tree-item[aria-current="true"]')?.textContent ?? null,
        files: document.querySelector(".reader-files")?.textContent ?? null,
        inSidebar: document.querySelector(".sidebar .reader-files") !== null,
        inReader: document.querySelector("aside.reader .reader-files") !== null,
        sidebarShown: document.querySelector<HTMLElement>(".sidebar")?.hidden === false,
        dragging: document.querySelector(".stage")?.hasAttribute("data-dragging") ?? null,
      }));
    await browser.waitUntil(async () => (await tree()).selected === "README.md", { timeout: 15000, interval: 250 }).catch(async () => {
      throw new Error(`README.md is not selected in the tree: ${JSON.stringify(await tree())}`);
    });
    expect((await tree()).files).toContain("guide.md");
    expect(await tree()).toMatchObject({ inSidebar: true, inReader: false, sidebarShown: true });
  });

  it("a click in the sidebar's tree opens the file and keeps the folder; with the sidebar hidden the tree is the reader's (three-column shell AC-11)", async () => {
    // Continues from the case above: docs/ is open, README.md selected.
    const pid = await hook<number>("ptyPid");
    const rendersBefore = renderedLines();
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar .reader-files .tree-item")].find((b) => b.textContent?.trim() === "guide.md")!.click());
    await waitForHeader("docs/guide.md");
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered]") !== null, "guide.md never finished rendering");
    const afterClick = await browser.execute(() => ({
      selected: document.querySelector('.sidebar .reader-files .tree-item[aria-current="true"]')?.textContent?.trim() ?? null,
      // Still there: a click dressed up as a `kinas open` would have cleared the open folder, and the section with it.
      sidebarTree: document.querySelector(".sidebar .reader-files") !== null,
      readerTree: document.querySelector("aside.reader .reader-files") !== null,
      filesButton: document.querySelector('.reader-head button[aria-label="Files"]') !== null,
    }));
    expect(afterClick).toEqual({ selected: "guide.md", sidebarTree: true, readerTree: false, filesButton: false });
    expect(await hook<number>("ptyPid")).toBe(pid);
    // A click is not a `kinas open`: it must add nothing to the log the 200 ms gate counts.
    await browser.pause(750);
    expect(renderedLines()).toBe(rendersBefore);

    // ⌘S hides the sidebar. The tree must not go with it, or a folder would show "Choose a file" and nothing to choose.
    await browser.keys(["Meta", "s"]);
    await waitInPage(() => document.querySelector<HTMLElement>(".sidebar")!.hidden, "⌘S did not hide the sidebar");
    await waitInPage(
      () => document.querySelector('.reader-head button[aria-label="Files"]') !== null || document.querySelector("aside.reader .reader-files") !== null,
      "the tree did not come back to the reader",
    );
    // Narrow, so it is behind the header's Files button; wide enough, it would already be a column.
    await browser.execute(() => {
      if (document.querySelector("aside.reader .reader-files") === null) document.querySelector<HTMLButtonElement>('.reader-head button[aria-label="Files"]')!.click();
    });
    await waitInPage(() => document.querySelector('aside.reader .reader-files .tree-item[aria-current="true"]')?.textContent?.trim() === "guide.md", "the reader's own tree never showed the open file");

    await browser.keys(["Meta", "s"]);
    await waitInPage(() => !document.querySelector<HTMLElement>(".sidebar")!.hidden, "⌘S did not bring the sidebar back");
    const back = await browser.execute(() => ({
      sidebarTree: document.querySelector(".sidebar .reader-files") !== null,
      readerTree: document.querySelector("aside.reader .reader-files") !== null,
      filesButton: document.querySelector('.reader-head button[aria-label="Files"]') !== null,
    }));
    expect(back).toEqual({ sidebarTree: true, readerTree: false, filesButton: false });
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("R1b: opens by bare name from an unrelated folder, and lists several matches without opening one", async () => {
    // Run from /private/tmp, nowhere near the projects folder: the name is searched for under it.
    const fromElsewhere = (...args: string[]) => {
      const result = spawnSync(CLI, ["open", ...args], { cwd: "/private/tmp", env: process.env, encoding: "utf8", timeout: 20000 });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    expect(fromElsewhere("other.md")).toMatchObject({ code: 0, stdout: `${join(root, "other.md")}\n` });
    await waitForHeader("other.md");

    // Two files of the same name: the reader lists them, newest first, and opens neither until one is clicked.
    mkdirSync(join(root, "one"), { recursive: true });
    mkdirSync(join(root, "two"), { recursive: true });
    writeFileSync(join(root, "one/dup.md"), "# The older one\n");
    writeFileSync(join(root, "two/dup.md"), "# The newer one\n");
    utimesSync(join(root, "one/dup.md"), new Date(1_000_000), new Date(1_000_000));
    utimesSync(join(root, "two/dup.md"), new Date(2_000_000), new Date(2_000_000));

    const picked = fromElsewhere("dup");
    expect(picked.code).toBe(0);
    expect(picked.stdout.trim().split("\n")).toEqual([join(root, "two/dup.md"), join(root, "one/dup.md")]);
    expect(picked.stderr).toContain("which of the 2 files");
    await waitInPage(() => document.querySelectorAll(".reader-picks .reader-pick").length === 2, "the picker never listed both matches");
    // toEndWith is Bun's matcher, not WebdriverIO's.
    expect(await headerText()).toMatch(/other\.md$/);

    await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-picks .reader-pick")!.click());
    await waitForHeader("two/dup.md");
  });

  it("opens a .sql and a .txt as source, with no Contents rail", async () => {
    // The file that started this build: `kinas open 0008_funnel_stage.sql` printed "is not a .md or .mdx file"
    // and exited 65. Run from /private/tmp, so the name is searched for under the projects folder as well.
    const fromElsewhere = (...args: string[]) => {
      const result = spawnSync(CLI, ["open", ...args], { cwd: "/private/tmp", env: process.env, encoding: "utf8", timeout: 20000 });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    expect(fromElsewhere("0008_funnel_stage.sql")).toMatchObject({ code: 0, stdout: `${join(root, "0008_funnel_stage.sql")}\n` });
    await waitForHeader("0008_funnel_stage.sql");
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered]") !== null, "the .sql never finished rendering");

    // Every page fact in one call: a `$` lookup costs about 5 s here, and a handful runs past mocha's timeout.
    const sql = await browser.execute(() => ({
      render: document.querySelector(".reader-doc")?.getAttribute("data-render") ?? null,
      source: document.querySelector(".reader-source") !== null,
      language: document.querySelector(".reader-source code")?.className ?? "",
      text: document.querySelector(".reader-source")?.textContent ?? "",
      // A source file has no headings, so Contents must not be offered (R28). This is what would catch source
      // accidentally routing through renderMarkdown.
      contents: document.querySelector(".reader-contents") !== null || document.querySelector('.reader-head button[aria-label="Contents"]') !== null,
      frontmatter: document.querySelector(".reader-frontmatter") !== null,
    }));
    expect(sql.render).toBe("source");
    expect(sql.source).toBe(true);
    expect(sql.language).toBe("language-sql");
    expect(sql.text).toContain("alter table leads");
    expect(sql.text).toContain("create index leads_by_stage");
    expect(sql.contents).toBe(false);
    expect(sql.frontmatter).toBe(false);

    // The fixture that used to assert its own refusal. No extension the table knows, so no language class.
    expect(kinas("notes.txt")).toMatchObject({ code: 0, stdout: `${join(root, "notes.txt")}\n` });
    await waitForHeader("notes.txt");
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered]") !== null, "notes.txt never finished rendering");
    const txt = await browser.execute(() => ({
      render: document.querySelector(".reader-doc")?.getAttribute("data-render") ?? null,
      language: document.querySelector(".reader-source code")?.className ?? "",
      text: document.querySelector(".reader-source")?.textContent ?? "",
    }));
    expect(txt.render).toBe("source");
    expect(txt.language).toBe("");
    expect(txt.text).toContain("A plain text file, opened as source.");
  });

  it("highlights code, numbers lines without polluting a copy, and loads nothing for prose", async () => {
    // A fence-free markdown file first: the highlighter's chunk must not load for prose (R10).
    expect(kinas("other.md").code).toBe(0);
    await waitForHeader("other.md");
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered]") !== null, "other.md never rendered");
    const prose = await browser.execute(() => ({
      chunks: performance.getEntriesByType("resource").filter((r) => /highlight/i.test(r.name)).length,
      highlighted: document.querySelectorAll("[data-highlighted]").length,
    }));
    expect(prose.chunks).toBe(0);
    expect(prose.highlighted).toBe(0);

    // Then the .sql, which must highlight and time its first load, the way Mermaid's 27 ms was measured (5.10).
    const started = await browser.execute(() => performance.now());
    expect(kinas("0008_funnel_stage.sql").code).toBe(0);
    await waitForHeader("0008_funnel_stage.sql");
    await waitInPage(() => document.querySelector(".reader-source code[data-highlighted]") !== null, "the .sql was never highlighted");
    const sql = await browser.execute((from: number) => ({
      ms: Math.round(performance.now() - from),
      keywords: document.querySelectorAll(".reader-source .hljs-keyword").length,
      gutter: document.querySelector(".reader-gutter")?.textContent?.split("\n").length ?? 0,
      codeLines: document.querySelector(".reader-source code")?.textContent?.replace(/\n$/, "").split("\n").length ?? 0,
      // The library ships a CSS theme we deliberately do not use: the colours come from tokens.css.
      themeLinks: [...document.querySelectorAll("link[rel=stylesheet]")].filter((l) => /highlight/i.test((l as HTMLLinkElement).href)).length,
    }), started);
    console.log(`reader e2e: the first highlighted open took ${sql.ms} ms including the grammar's chunk`);
    expect(sql.keywords).toBeGreaterThan(0);
    expect(sql.themeLinks).toBe(0);
    // One number per line of code, no more: the gutter is generated from the same text.
    expect(sql.gutter).toBe(sql.codeLines);

    // R20: selecting the file and copying must yield code and no line numbers. The gutter is a sibling element
    // marked user-select: none, which is the only arrangement compatible with one highlighted HTML string.
    const copied = await browser.execute(() => {
      const wrap = document.querySelector(".reader-source-wrap")!;
      const range = document.createRange();
      range.selectNodeContents(wrap);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    });
    expect(copied).toContain("alter table leads");
    // No line number survives: every line of a numbered copy would start with its digits.
    expect(copied.split("\n").filter((line) => /^\s*\d+\s/.test(line)).length).toBe(0);

    // A minified file is one enormous line: skipped, and marked so, rather than highlighted slowly (R10).
    const big = join(root, "minified.js");
    writeFileSync(big, `const x=[${"1,".repeat(300000)}0];\n`);
    expect(kinas("minified.js").code).toBe(0);
    await waitForHeader("minified.js");
    await waitInPage(() => document.querySelector('.reader-source code[data-highlight="skipped"]') !== null, "the minified file was not skipped");
    expect(await browser.execute(() => document.querySelector(".reader-source code[data-highlighted]") === null)).toBe(true);
    rmSync(big);
  });

  it("R18 probe: a sandboxed, policy-injected frame reaches neither the network nor the app", async () => {
    // The one thing about this work that reading could not settle: whether WebKit enforces a meta-delivered CSP
    // inside a sandboxed srcdoc frame that is allowed to run scripts (R18). No preview UI exists yet by design —
    // the frame is built here, exactly as task 7.0 will build it, and the answer decides whether 7.0 ships
    // scripts at all. The listener in reader.setup.ts is a real socket: "no requests" inferred from a missing
    // <script> element is the assertion a breached reader would still pass.
    const probeUrl = process.env.KINAS_E2E_PROBE_URL!;
    const before = await browser.execute(() => ({ url: location.href, title: document.title }));

    const openFrame = async (id: string, file: string) => {
      const html = injectCsp(readFileSync(join(root, file), "utf8"));
      await browser.execute(
        (frameId: string, doc: string, sandbox: string) => {
          const frame = document.createElement("iframe");
          frame.id = frameId;
          frame.setAttribute("sandbox", sandbox);
          // Assigned as a property. The file's bytes must never pass through the parent document's innerHTML,
          // which fires inline handlers and loads remote resources even though it does not run <script> (R13).
          frame.srcdoc = doc;
          frame.addEventListener("load", () => frame.setAttribute("data-loaded", ""));
          document.body.appendChild(frame);
        },
        id,
        html,
        PREVIEW_SANDBOX,
      );
      await waitInPageWith((frameId: string) => document.querySelector(`#${frameId}[data-loaded]`) !== null, id, `${file} never loaded in its frame`);
    };

    await openFrame("kinas-probe", "hostile.html");
    // The benign page is what stops this suite passing against a preview that renders nothing at all: an empty
    // frame makes no requests either.
    await openFrame("kinas-benign", "preview.html");
    await browser.waitUntil(async () => (await hook<number>("readerPreviewMessages")) > 0, {
      timeout: 15000,
      interval: 250,
      timeoutMsg: "the benign preview's inline script never ran",
    });

    // Observed on the socket, not inferred.
    const log = (await (await fetch(`${probeUrl}/__log`)).json()) as { requests: number; hits: { method: string; path: string }[] };
    expect(log.hits).toEqual([]);
    expect(log.requests).toBe(0);

    const after = await browser.execute(() => ({
      url: location.href,
      title: document.title,
      pwned: typeof (window as unknown as { __pwned?: unknown }).__pwned,
      sandbox: document.querySelector("#kinas-probe")?.getAttribute("sandbox") ?? "",
    }));
    expect(after.pwned).toBe("undefined");
    expect(after.url).toBe(before.url);
    expect(after.title).toBe(before.title);
    // The attribute that actually carries the isolation, read back off the live element.
    expect(after.sandbox).toBe("allow-scripts");
    expect(after.sandbox).not.toContain("allow-same-origin");
    // The app still answers after the fixture's modal loop: no allow-modals means alert() never blocked it.
    expect(await hook<boolean>("isVisible")).toBe(true);

    await browser.execute(() => {
      for (const id of ["kinas-probe", "kinas-benign"]) document.querySelector(`#${id}`)?.remove();
    });
  });

  it("an .html file opens as the page it is, toggles to its markup and back, and a save re-renders the same frame", async () => {
    // The hook counts every message this session, and the R18 probe above already pushed it past zero — so the
    // assertion below must be an *increase*. `> 0` would pass even if this page's script never ran at all.
    const messagesBefore = await hook<number>("readerPreviewMessages");
    expect(kinas("preview.html").code).toBe(0);
    await waitForHeader("preview.html");
    // `data-rendered` lands only after hydrate has awaited the frame's own load event.
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered] .reader-preview-frame") !== null, "preview.html never rendered a frame");

    const shown = await browser.execute(() => ({
      sandbox: document.querySelector("iframe.reader-preview-frame")?.getAttribute("sandbox") ?? "",
      render: document.querySelector(".reader-doc")?.getAttribute("data-render") ?? "",
      // Neither the rail nor, docked and narrow, the header button that stands in for it.
      contents: document.querySelectorAll('.reader-contents, .reader-head button[aria-label="Contents"]').length,
      // Every element the parent document actually holds for this file. This, not a substring, is what tells a
      // parsed document apart from one carried in an attribute.
      tags: [...document.querySelectorAll(".reader-body *")].map((e) => e.tagName.toLowerCase()).join(","),
      bodyHtml: document.querySelector(".reader-body")?.innerHTML ?? "",
    }));
    expect(shown.sandbox).toBe("allow-scripts");
    expect(shown.sandbox).not.toContain("allow-same-origin");
    expect(shown.render).toBe("html");
    // A preview reports no headings, so the Contents rail hides itself.
    expect(shown.contents).toBe(0);
    // R13: the page's bytes are assigned to the frame's `srcdoc` as a *property*, and are never parsed as markup
    // in the parent document. Proved structurally — the parent holds only the placeholder and the frame.
    //
    // Do not assert this with a substring of the file's text. Reading `innerHTML` back **serialises** the
    // `srcdoc` attribute, so the whole document unavoidably appears in that string, HTML-escaped; its presence is
    // a read-back artefact and proves nothing either way. An *element* from the file is what would prove a
    // breach, and an unescaped tag is what would show the parser had run.
    expect(shown.tags).toBe("div,iframe");
    expect(shown.bodyHtml).toContain("reader-preview");
    expect(shown.bodyHtml).not.toContain("<h1>");
    expect(shown.bodyHtml).not.toContain("<script>");

    // The inline script ran, reported the only way an opaque-origin frame can (R19).
    await browser.waitUntil(async () => (await hook<number>("readerPreviewMessages")) > messagesBefore, {
      timeout: 15000,
      interval: 250,
      timeoutMsg: "the preview's inline script never ran",
    });

    // Two buttons since 2026-09-18, Rendered and Source, and `aria-pressed` on each says which view is showing.
    // Found by their own labels inside `.reader-view`, never by `[aria-pressed]` alone: the narrow-mode Files and
    // Contents buttons carry that attribute too, and a first-match selector would silently read one of those.
    expect(await viewState()).toEqual({ rendered: "true", source: "false" });
    await clickView("Source");
    await waitInPage(() => document.querySelector(".reader-source") !== null, "the toggle never showed the markup");
    const asSource = await browser.execute(() => ({
      frames: document.querySelectorAll("iframe.reader-preview-frame").length,
      text: document.querySelector(".reader-source")?.textContent ?? "",
    }));
    expect(asSource.frames).toBe(0);
    // Escaped, not executed: the markup is visible as text.
    expect(asSource.text).toContain("<script>");
    expect(await viewState()).toEqual({ rendered: "false", source: "true" });

    await clickView("Rendered");
    await waitInPage(() => document.querySelector(".reader-preview-frame") !== null, "the toggle never rendered the page again");
    expect(await viewState()).toEqual({ rendered: "true", source: "false" });

    // R17: a save re-renders by reassigning srcdoc on the **same element**, so the layout does not jump. Marking
    // the node is the only way to tell that apart from a convincing replacement.
    const was = await browser.execute(() => {
      const f = document.querySelector<HTMLIFrameElement>("iframe.reader-preview-frame")!;
      (f as unknown as { __kinasMark?: number }).__kinasMark = 7;
      return f.dataset.hash ?? "";
    });
    appendFileSync(join(root, "preview.html"), "\n<p>appended</p>\n");
    await waitInPageWith(
      (hash: string) => document.querySelector<HTMLIFrameElement>("iframe.reader-preview-frame")?.dataset.hash !== hash,
      was,
      "the save never re-rendered the preview",
    );
    expect(await browser.execute(() => (document.querySelector("iframe.reader-preview-frame") as unknown as { __kinasMark?: number } | null)?.__kinasMark ?? 0)).toBe(7);
  });

  it("AC-4 through the reader's own path: a hostile page rendered by the UI still reaches nothing", async () => {
    // The probe built its frame by hand. This opens the same fixture the way Miguel would, so the guarantee is
    // proved on the path that actually ships, not only on the one the probe assembled.
    const probeUrl = process.env.KINAS_E2E_PROBE_URL!;
    const before = await browser.execute(() => ({ url: location.href, title: document.title }));
    expect(kinas("hostile.html").code).toBe(0);
    await waitForHeader("hostile.html");
    await waitInPage(() => document.querySelector(".reader-doc[data-rendered] .reader-preview-frame") !== null, "hostile.html never finished rendering");

    const log = (await (await fetch(`${probeUrl}/__log`)).json()) as { requests: number; hits: { method: string; path: string }[] };
    expect(log.hits).toEqual([]);
    expect(log.requests).toBe(0);

    const after = await browser.execute(() => ({
      url: location.href,
      title: document.title,
      pwned: typeof (window as unknown as { __pwned?: unknown }).__pwned,
    }));
    expect(after.pwned).toBe("undefined");
    expect(after.url).toBe(before.url);
    expect(after.title).toBe(before.title);
    expect(await hook<boolean>("isVisible")).toBe(true);
  });

  it("AC-6: nothing in a file runs, navigates or fetches", async () => {
    expect(kinas("hostile.md").code).toBe(0);
    await waitForHeader("hostile.md");
    await $(".reader-doc[data-rendered]").waitForExist({ timeout: 15000 });
    const url = await browser.getUrl();

    // typeof in the page: WebDriver returns an undefined value as null.
    const pwned = () => browser.execute(() => typeof (window as unknown as { __pwned?: unknown }).__pwned);
    expect(await pwned()).toBe("undefined");
    expect(await $$(".reader-doc script").length).toBe(0);
    expect(await $('img[alt="remote"]').getAttribute("src")).toBeNull();
    for (const selector of ['.reader-body a[href="https://example.com"]', '.reader-body a[href="https://example.com/p.png"]']) {
      const link = await $(selector);
      await browser.execute((el) => (el as unknown as HTMLElement).click(), link);
    }
    await browser.pause(500);
    expect(await browser.getUrl()).toBe(url);
    expect(await pwned()).toBe("undefined");
  });
});
