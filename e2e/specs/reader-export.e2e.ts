import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hook, openReaderMenu, runReaderMenuItem, waitForShell } from "../helpers.ts";

// Download and Print (tasks/three-column-shell-build-spec.md AC-7, AC-9, AC-10). The two native sheets are replaced
// by debug-only seams (reader-export.setup.ts): the save sheet's answer is KINAS_E2E_EXPORT_TO, and the print sheet
// is not raised. What is proved here is everything on our side of those sheets.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const out = realpathSync(process.env.KINAS_E2E_OUT!);
const dest = join(out, "plan copy.md");
const LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");

function kinasOpen(...args: string[]) {
  return spawnSync(CLI, ["open", ...args], { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 }).status;
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

const statusLog = () => hook<string>("readerStatusLog");
const logLines = (needle: string) => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter((line) => line.includes(needle)) : []);

interface Item {
  label: string;
  disabled: boolean;
  title: string;
}

/**
 * Every item of the ▾ menu as the page shows it, in order, then the menu closed again.
 *
 * An array, not an object keyed by label: an object's key order does not survive the WebDriver wire (it came back
 * alphabetised), and the order of the menu is one of the things being asserted.
 */
async function menuItems(): Promise<Item[]> {
  await openReaderMenu();
  const items = await browser.execute(() =>
    [...document.querySelectorAll<HTMLButtonElement>('.reader-menu [role="menuitem"]')].map((b) => ({
      label: b.textContent?.trim() ?? "",
      disabled: b.getAttribute("aria-disabled") === "true",
      title: b.getAttribute("title") ?? "",
    })),
  );
  await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-head [aria-haspopup="menu"]')!.click());
  await browser.waitUntil(() => browser.execute(() => document.querySelector(".reader-menu") === null), { timeout: 10000, timeoutMsg: "the menu never closed" });
  return items;
}

describe("Download and Print", () => {
  before(async () => {
    await waitForShell();
  });

  it("AC-9: the webview cannot raise a dialog of its own", async () => {
    // The plugin is registered so that Rust can open the save sheet; no capability grants a `dialog:*` permission, and
    // Tauri checks the ACL on every `plugin:` command. If one of these ever resolved, a native dialog would be up
    // and this run would hang on it — which fails loudly too.
    const answers = (await browser.executeAsync((done: (v: string[]) => void) => {
      const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      const commands = ["save", "open", "message", "ask", "confirm"];
      void Promise.all(
        commands.map((c) =>
          invoke(`plugin:dialog|${c}`, { options: {}, message: "from the page", title: "x" }).then(
            () => `${c}: RESOLVED`,
            (e: unknown) => `${c}: rejected ${String(e)}`,
          ),
        ),
      ).then(done);
    })) as string[];
    expect(answers).toHaveLength(5);
    for (const answer of answers) expect(answer).toMatch(/^(save|open|message|ask|confirm): rejected /);
  });

  it("AC-7: a copy lands where the sheet said, byte for byte, and nothing about where is kept", async () => {
    expect(kinasOpen("plan-300.md")).toBe(0);
    await opened("plan-300.md");
    expect(readdirSync(out)).toEqual([]);
    const exportedBefore = logLines("reader: exported").length;

    await runReaderMenuItem("Download as .md");
    await browser.waitUntil(async () => (await statusLog()).includes("Saved plan copy.md"), { timeout: 20000, timeoutMsg: `the reader never said the copy was saved; it said: ${await statusLog()}` });

    expect(readFileSync(dest).equals(readFileSync(join(root, "plan-300.md")))).toBe(true);
    // Exactly the copy: the temp file it was written through is gone.
    expect(readdirSync(out)).toEqual(["plan copy.md"]);

    // The log gained one line, and it is counts only — no name, no folder.
    const exported = logLines("reader: exported");
    expect(exported.length).toBe(exportedBefore + 1);
    expect(exported.at(-1)).toMatch(/reader: exported \d+ bytes in \d+ ms$/);
    expect(logLines(out)).toEqual([]);
    expect(logLines("plan copy.md")).toEqual([]);
    // Nor does the page hear the folder: the status line names the file, and nothing else does.
    expect(await statusLog()).not.toContain(out);
  });

  it("a refusal is Rust's, word for word, and leaves the folder as it was", async () => {
    // The name is now taken by a folder. (The save sheet would not offer this; a seam, a race or a symlink can.)
    rmSync(dest);
    mkdirSync(dest);
    await runReaderMenuItem("Download as .md");
    await browser.waitUntil(async () => (await statusLog()).includes("That name is taken by something that isn't a plain file"), {
      timeout: 20000,
      timeoutMsg: `the refusal never showed; the reader said: ${await statusLog()}`,
    });
    expect(readdirSync(out)).toEqual(["plan copy.md"]);
    expect(readdirSync(dest)).toEqual([]);
    rmSync(dest, { recursive: true });
  });

  it("AC-10: Print asks Rust for the sheet, and each kind of file offers what it can do", async () => {
    // Still plan-300.md, rendered: everything is on.
    const markdown = await menuItems();
    expect(markdown.map((item) => item.label)).toEqual(["Download as .md", "Print as PDF", "Open in editor"]);
    expect(markdown.every((item) => !item.disabled)).toBe(true);

    const skippedBefore = logLines("print skipped because KINAS_E2E_NO_PRINT is set").length;
    await runReaderMenuItem("Print as PDF");
    await browser.waitUntil(() => logLines("print skipped because KINAS_E2E_NO_PRINT is set").length === skippedBefore + 1, {
      timeout: 15000,
      timeoutMsg: "Print never reached Rust",
    });

    // An image: no text to copy, nothing to print from here; a copy is still a copy.
    expect(kinasOpen("diagram.png")).toBe(0);
    await opened("diagram.png");
    const image = await menuItems();
    expect(image.find((item) => item.label === "Download as .png")).toEqual({ label: "Download as .png", disabled: false, title: "" });
    expect(image.find((item) => item.label === "Print as PDF")).toEqual({ label: "Print as PDF", disabled: true, title: "Images can't be printed from here" });
    const copy = await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>(".reader-copy-main")!;
      return { disabled: button.getAttribute("aria-disabled") === "true", title: button.getAttribute("title") ?? "" };
    });
    expect(copy).toEqual({ disabled: true, title: "Images can't be copied as text" });

    // A rendered HTML page is a sandboxed frame, which prints clipped: its source prints, the page does not.
    expect(kinasOpen("preview.html")).toBe(0);
    await opened("preview.html");
    const printItem = async () => (await menuItems()).find((item) => item.label === "Print as PDF");
    expect(await printItem()).toEqual({ label: "Print as PDF", disabled: true, title: "Switch to Source to print" });
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-view button[aria-label="Source"]')!.click());
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".reader-source") !== null), { timeout: 15000, timeoutMsg: "the page never showed as its markup" });
    expect(await printItem()).toEqual({ label: "Print as PDF", disabled: false, title: "" });
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-view button[aria-label="Rendered"]')!.click());
  });

  it("the print stylesheet is loaded, and prints the document alone", async () => {
    // What the sheet would print is proved on the engine by scripts/print-probe.ts; this only proves the app ships
    // the same rules. Weak on its own, which is why the real gate is the probe and a line in the smoke test.
    const rules = await browser.execute(() => {
      const found: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...sheet.cssRules]) {
          if (rule instanceof CSSMediaRule && rule.conditionText.trim() === "print") found.push(...[...rule.cssRules].map((r) => r.cssText));
        }
      }
      return found.join("\n");
    });
    expect(rules).toContain(".shell-panel");
    expect(rules).toMatch(/\.content[^{]*\{[^}]*display:\s*none\s*!important/);
    expect(rules).toContain("@page");
  });
});
