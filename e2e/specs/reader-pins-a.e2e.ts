import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hook, runReaderMenuItem, waitForShell } from "../helpers.ts";

// Pinned and Recent, first launch (tasks/three-column-shell-build-spec.md AC-12, AC-13). `reader-pins-b` is the
// second launch over the same data folder: what is pinned here must be there, and what was merely opened must not.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const APP_LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");
const PINNED_FILE = "pin-me-7f3a.md";
const GONE_FILE = "pinned-then-gone-7f3a.md";

function kinas(...args: string[]) {
  const result = spawnSync(CLI, args, { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
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

interface Row {
  name: string;
  disabled: boolean;
  title: string;
  expanded: string;
}

/** A sidebar section's rows, in order. An array: an object's key order does not survive the WebDriver wire. */
const rows = (section: "pinned" | "recent") =>
  browser.execute(
    (s: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(`.sidebar-${s} .sidebar-list > li > .sidebar-row, .sidebar-${s} .sidebar-list > li > .sidebar-pin > .sidebar-row`)].map((b) => ({
        name: b.querySelector(".sidebar-row-name")?.textContent ?? "",
        disabled: b.getAttribute("aria-disabled") === "true",
        title: b.getAttribute("title") ?? "",
        expanded: b.getAttribute("aria-expanded") ?? "",
      })),
    section,
  ) as Promise<Row[]>;

const sectionShown = (section: "pinned" | "recent") => browser.execute((s: string) => document.querySelector(`.sidebar-${s}`) !== null, section);

const clickRow = (section: "pinned" | "recent", name: string) =>
  browser.execute(
    (s: string, wanted: string) => {
      const row = [...document.querySelectorAll<HTMLButtonElement>(`.sidebar-${s} .sidebar-row`)].find((b) => b.querySelector(".sidebar-row-name")?.textContent === wanted);
      row?.click();
      return row !== undefined;
    },
    section,
    name,
  );

const unpinRow = (name: string) =>
  browser.execute((wanted: string) => {
    const pin = [...document.querySelectorAll<HTMLElement>(".sidebar-pinned .sidebar-pin")].find((p) => p.querySelector(".sidebar-row-name")?.textContent === wanted);
    pin?.querySelector<HTMLButtonElement>('button[aria-label="Unpin"]')?.click();
    return pin !== undefined;
  }, name);

const statusLog = () => hook<string>("readerStatusLog");
const header = () => browser.execute(() => document.querySelector(".reader-path")?.textContent ?? "");

/** One reader command, called the way the page calls it. Answers `ok:<json>` or `refused:<message>`. */
const invokeReader = (command: string, path: string) =>
  browser.executeAsync(
    (c: string, p: string, done: (v: string) => void) => {
      const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      invoke(c, { path: p }).then(
        (v) => done(`ok:${JSON.stringify(v)}`),
        (e: unknown) => done(`refused:${(e as { message?: string })?.message ?? String(e)}`),
      );
    },
    command,
    path,
  ) as Promise<string>;

/** The sidebar reloads its pins when the window comes forward; this is that, without needing a real window switch. */
const refreshPins = () => browser.execute(() => void window.dispatchEvent(new Event("focus")));

describe("Pinned and Recent, first launch", () => {
  before(async () => {
    await waitForShell();
  });

  it("a fresh launch shows no Pinned and no Recent section at all", async () => {
    expect(await sectionShown("pinned")).toBe(false);
    expect(await sectionShown("recent")).toBe(false);
    expect(await browser.execute(() => document.querySelector(".sidebar .reader-files"))).toBeNull();
  });

  it("AC-12: a file pinned from the menu and a folder pinned from its header are listed, and kept out of the log and the CLI", async () => {
    expect(kinas("open", PINNED_FILE).code).toBe(0);
    await opened(PINNED_FILE);
    await runReaderMenuItem("Pin");
    await browser.waitUntil(async () => (await rows("pinned")).some((r) => r.name === PINNED_FILE), { timeout: 15000, timeoutMsg: "the pinned file never appeared in the sidebar" });
    expect(await statusLog()).toContain(`Pinned ${PINNED_FILE}`);

    // The folder, from the Files section's own header.
    expect(kinas("open", "docs").code).toBe(0);
    await opened("docs/README.md");
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.sidebar .reader-files button[aria-label="Pin this folder"]')!.click());
    await browser.waitUntil(async () => (await rows("pinned")).length === 2, { timeout: 15000, timeoutMsg: "the pinned folder never appeared in the sidebar" });
    expect(await rows("pinned")).toEqual([
      { name: PINNED_FILE, disabled: false, title: PINNED_FILE, expanded: "" },
      { name: "docs", disabled: false, title: "docs", expanded: "false" },
    ]);
    // The header's button now offers the way back.
    expect(await browser.execute(() => document.querySelector('.sidebar .reader-files button[aria-label="Unpin this folder"]') !== null)).toBe(true);

    // Stored, as the reader's own real paths.
    const stored = await invokeReader("reader_pins", "");
    expect(stored.startsWith("ok:")).toBe(true);
    expect(JSON.parse(stored.slice(3))).toEqual([
      { path: join(root, PINNED_FILE), display_path: PINNED_FILE, kind: "file", exists: true },
      { path: join(root, "docs"), display_path: "docs", kind: "dir", exists: true },
    ]);

    // Nowhere else: not in what the CLI prints, not in the log.
    const status = kinas("status", "--json");
    expect(status.code).toBe(0);
    expect(status.stdout).not.toContain("reader_pins");
    expect(status.stdout).not.toContain(PINNED_FILE);
    const log = existsSync(APP_LOG) ? readFileSync(APP_LOG, "utf8") : "";
    expect(log).not.toContain(PINNED_FILE);
    expect(log).not.toContain(join(root, "docs"));
  });

  it("a pinned folder opens as a tree, and the open file's menu says Unpin", async () => {
    expect(await clickRow("pinned", "docs")).toBe(true);
    await browser.waitUntil(async () => (await rows("pinned")).find((r) => r.name === "docs")?.expanded === "true", { timeout: 15000, timeoutMsg: "the pinned folder never expanded" });
    await browser.waitUntil(() => browser.execute(() => [...document.querySelectorAll(".sidebar-pin-tree .tree-item")].some((b) => b.textContent?.trim() === "guide.md")), {
      timeout: 15000,
      timeoutMsg: "the pinned folder's tree never listed guide.md",
    });
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar-pin-tree .tree-item")].find((b) => b.textContent?.trim() === "guide.md")!.click());
    await opened("docs/guide.md");

    expect(await clickRow("pinned", PINNED_FILE)).toBe(true);
    await opened(PINNED_FILE);
    // Offered as Unpin — and left alone, because the second launch expects this pin.
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.reader-head [aria-haspopup="menu"]')!.click());
    await browser.waitUntil(() => browser.execute(() => document.querySelector('.reader-menu [role="menuitem"]') !== null), { timeout: 10000, timeoutMsg: "the menu never opened" });
    const labels = await browser.execute(() => [...document.querySelectorAll(".reader-menu [role=menuitem]")].map((b) => b.textContent?.trim() ?? ""));
    expect(labels).toEqual(["Download as .md", "Print as PDF", "Open in editor", "Unpin"]);
    await browser.keys("Escape");
  });

  it("AC-12: a pin whose file is gone stays, greyed, does nothing when clicked, and only Unpin removes it", async () => {
    expect(kinas("open", GONE_FILE).code).toBe(0);
    await opened(GONE_FILE);
    await runReaderMenuItem("Pin");
    await browser.waitUntil(async () => (await rows("pinned")).some((r) => r.name === GONE_FILE), { timeout: 15000, timeoutMsg: "the second file never appeared in the sidebar" });

    expect(kinas("open", "other.md").code).toBe(0);
    await opened("other.md");
    rmSync(join(root, GONE_FILE));
    await refreshPins();
    await browser.waitUntil(async () => (await rows("pinned")).find((r) => r.name === GONE_FILE)?.disabled === true, { timeout: 15000, timeoutMsg: "the missing pin never greyed out" });
    // Still listed, and it says why it is grey. Kinas did not remove it.
    expect((await rows("pinned")).find((r) => r.name === GONE_FILE)).toEqual({ name: GONE_FILE, disabled: true, title: `${GONE_FILE} is missing`, expanded: "" });

    expect(await clickRow("pinned", GONE_FILE)).toBe(true);
    await browser.pause(750);
    expect(await header()).toMatch(/other\.md$/);

    expect(await unpinRow(GONE_FILE)).toBe(true);
    await browser.waitUntil(async () => !(await rows("pinned")).some((r) => r.name === GONE_FILE), { timeout: 15000, timeoutMsg: "Unpin did not remove the missing pin" });
    expect((await rows("pinned")).map((r) => r.name)).toEqual([PINNED_FILE, "docs"]);
  });

  it("AC-12: the 51st pin is refused in Rust's words, and a path outside the projects folder cannot be pinned at all", async () => {
    const extra = Array.from({ length: 49 }, (_, i) => `cap-${String(i + 1).padStart(2, "0")}.md`);
    for (const name of extra) writeFileSync(join(root, name), `# ${name}\n`);
    // 2 pinned already, so 48 more make 50.
    for (const name of extra.slice(0, 48)) expect((await invokeReader("reader_pin", join(root, name))).startsWith("ok:")).toBe(true);
    expect(await invokeReader("reader_pin", join(root, extra[48]!))).toBe("refused:50 pins is the limit — unpin something first");
    // Pinning what is already pinned is still not an error when the list is full.
    expect((await invokeReader("reader_pin", join(root, PINNED_FILE))).startsWith("ok:")).toBe(true);

    // A pin widens no access: the reader may not read this, so it may not pin it either.
    expect(await invokeReader("reader_pin", "/etc/hosts")).toMatch(/^refused:/);

    for (const name of extra.slice(0, 48)) expect((await invokeReader("reader_unpin", join(root, name))).startsWith("ok:")).toBe(true);
    await refreshPins();
    await browser.waitUntil(async () => (await rows("pinned")).length === 2, { timeout: 15000, timeoutMsg: "the sidebar never went back to two pins" });
  });

  it("AC-13: Recent holds 15, newest first, and lists a file once", async () => {
    const names = Array.from({ length: 16 }, (_, i) => `recent-${String(i + 1).padStart(2, "0")}.md`);
    for (const name of names) writeFileSync(join(root, name), `# ${name}\n`);
    for (const name of names) {
      expect(kinas("open", name).code).toBe(0);
      await opened(name);
    }
    const listed = (await rows("recent")).map((r) => r.name);
    expect(listed).toHaveLength(15);
    expect(listed).toEqual([...names].reverse().slice(0, 15));

    // The first one, opened again through the sidebar's own door, comes back to the front — still 15, still once each.
    expect(kinas("open", names[0]!).code).toBe(0);
    await opened(names[0]!);
    const again = (await rows("recent")).map((r) => r.name);
    expect(again).toHaveLength(15);
    expect(again[0]).toBe(names[0]);
    expect(new Set(again).size).toBe(15);

    // A Recent row opens its file.
    expect(await clickRow("recent", names[5]!)).toBe(true);
    await opened(names[5]!);
  });
});
