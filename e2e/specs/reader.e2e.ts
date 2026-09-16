import { $, $$, browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hook, waitForShell } from "../helpers.ts";

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

/**
 * Waits on a condition read inside the page. Each WebDriver element lookup costs about 5 s under this driver, and a
 * handful of them runs past mocha's 120 s per-test timeout. `condition` runs in the page, so it must be
 * self-contained.
 */
async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
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
      contents: document.querySelector(".reader-contents") !== null,
    }));
    expect(page.frontmatter).toContain("Reader fixture plan");
    expect(page.diagram).toBe(true);
    expect(page.image).toMatch(/^blob:/);
    expect(page.contents).toBe(true);
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
    const share = () =>
      browser.execute(() => document.querySelector<HTMLElement>("aside.reader")!.getBoundingClientRect().width / document.querySelector<HTMLElement>(".work")!.getBoundingClientRect().width);
    const stored = () =>
      browser.execute(() =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<{ reader_width_pct: number }> } }).__TAURI_INTERNALS__.invoke("get_ui_prefs").then((p) => p.reader_width_pct),
      );
    const cols = await hook<{ cols: number }>("terminalSize");

    await browser.execute(() => {
      const divider = document.querySelector<HTMLElement>(".work-divider")!;
      const row = document.querySelector<HTMLElement>(".work")!.getBoundingClientRect();
      const send = (type: string, x: number) =>
        divider.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 200, pointerId: 1, button: 0, isPrimary: true }));
      send("pointerdown", divider.getBoundingClientRect().left + 3);
      send("pointermove", row.left + row.width * 0.5);
      send("pointerup", row.left + row.width * 0.35);
    });
    await browser.waitUntil(async () => Math.abs((await share()) - 0.35) < 0.02, { timeout: 10000, timeoutMsg: "the reader did not take 35 % of the row" });
    await browser.waitUntil(async () => (await stored()) === 35, { timeout: 10000, timeoutMsg: "the width was not remembered" });
    // The terminal refits to its wider box.
    await browser.waitUntil(async () => (await hook<{ cols: number }>("terminalSize")).cols > cols.cols, { timeout: 10000, timeoutMsg: "the terminal did not refit" });

    await browser.execute(() => document.querySelector<HTMLElement>(".work-divider")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await browser.waitUntil(async () => (await stored()) === 55, { timeout: 10000, timeoutMsg: "double-click did not restore 55 %" });
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
    // Read in the page, with the layout facts that would explain a missing tree (a narrow reader hides it).
    const tree = () =>
      browser.execute(() => ({
        selected: document.querySelector('.reader-files .tree-item[aria-current="true"]')?.textContent ?? null,
        files: document.querySelector(".reader-files")?.textContent ?? null,
        narrow: document.querySelector(".reader-main")?.hasAttribute("data-narrow") ?? null,
        readerWidth: Math.round(document.querySelector<HTMLElement>("aside.reader")?.getBoundingClientRect().width ?? 0),
        dragging: document.querySelector(".work")?.hasAttribute("data-dragging") ?? null,
      }));
    await browser.waitUntil(async () => (await tree()).selected === "README.md", { timeout: 15000, interval: 250 }).catch(async () => {
      throw new Error(`README.md is not selected in the tree: ${JSON.stringify(await tree())}`);
    });
    expect((await tree()).files).toContain("guide.md");
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
      // A source file has no headings, so the rail must not appear (R28). This is what would catch source
      // accidentally routing through renderMarkdown.
      contents: document.querySelector(".reader-contents") !== null,
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
