import { browser, expect } from "@wdio/globals";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { herdr, herdrSnapshot, hook, stopHerdrSession, waitForHook } from "../helpers.ts";
import { SESSION } from "./reader-terminal.setup.ts";

// Folders in the sidebar (2026-09-21): a folder is pinned from its own row, an opened folder joins Recent, and a
// folder's terminal button asks Herdr for its workspace — in the throwaway session, never `default` — and types
// nothing into the pane. Everything is clicked and read inside the page: a lookup costs about 5 s under this driver,
// and the folder buttons are out of the layout until their row is pointed at, which a script's click does not need.

const CLI = join(process.cwd(), "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");
const root = realpathSync(process.env.KINAS_ROOT!);
const APP_LOG = join(homedir(), "Library/Logs/ai.sintralabs.kinas/kinas.log");
const ALPHA = "proj-alpha-9c2e";
const BETA = "proj-beta-9c2e";
const LOOSE = "loose-9c2e.md";
/** A `cd` to an absolute path, typed or pasted: what this feature must never put in the pane. */
const TYPED_CD = /\bcd\s+['"]?\//;

function kinas(...args: string[]) {
  const result = spawnSync(CLI, args, { cwd: root, env: process.env, encoding: "utf8", timeout: 20000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function waitInPageWith(condition: (arg: string) => boolean, arg: string, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition, arg), { timeout, interval: 250, timeoutMsg });
}

const opened = (suffix: string) =>
  waitInPageWith(
    (s: string) => (document.querySelector(".reader-path")?.textContent ?? "").endsWith(s) && document.querySelector(".reader-doc[data-rendered]") !== null,
    suffix,
    `${suffix} never finished rendering`,
  );

/** Recent, in order, as `kind:name`. An array: an object's key order does not survive the WebDriver wire. */
const recent = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLLIElement>(".sidebar-recent .sidebar-list > li")].map((li) => `${li.dataset.kind ?? "?"}:${li.querySelector(".sidebar-row-name")?.textContent ?? ""}`),
  ) as Promise<string[]>;

/** Clicks the button with this label inside `scope`. False when it is not there. */
const clickLabelled = (scope: string, label: string) =>
  browser.execute(
    (s: string, l: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${s} button`)].find((b) => b.getAttribute("aria-label") === l);
      button?.click();
      return button !== undefined;
    },
    scope,
    label,
  );

/**
 * Clicks a labelled button and waits, in the same script, for the sidebar's notice to match — the line lasts 6 s,
 * less than two round-trips under this driver. Answers the matching text, or whatever was last there.
 */
const clickAndReadNotice = (scope: string, label: string, pattern: string) =>
  browser.executeAsync(
    (s: string, l: string, source: string, done: (text: string) => void) => {
      const wanted = new RegExp(source);
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${s} button`)].find((b) => b.getAttribute("aria-label") === l);
      if (!button) return done(`(no button labelled ${l})`);
      button.click();
      const started = Date.now();
      let last = "(no notice)";
      const poll = () => {
        const text = document.querySelector(".sidebar-notice")?.textContent;
        if (text) last = text;
        if (text && wanted.test(text)) return done(text);
        if (Date.now() - started > 15000) return done(last);
        setTimeout(poll, 100);
      };
      poll();
    },
    scope,
    label,
    pattern,
  ) as Promise<string>;

const showing = (page: "home" | "usage" | "work") => browser.execute((p: string) => !document.querySelector<HTMLElement>(`section[data-page="${p}"]`)!.hidden, page);

const logLines = (needle: string) => (existsSync(APP_LOG) ? readFileSync(APP_LOG, "utf8").split("\n").filter((line) => line.includes(needle)) : []);

describe("Folders in the sidebar", () => {
  it("a folder is pinned from its own row in a file tree, and its buttons take no room until the row is pointed at", async () => {
    expect(kinas("open", ".").code).toBe(0);
    await waitInPageWith(
      (name: string) => [...document.querySelectorAll(".sidebar .reader-files .tree-dir")].some((b) => (b.getAttribute("title") ?? "").endsWith(`/${name}`)),
      ALPHA,
      "the projects folder never listed its folders in the sidebar",
    );

    // Out of the layout, not merely unseen: at most the one row under the pointer shows its buttons.
    const shape = await browser.execute(() => {
      const actions = [...document.querySelectorAll<HTMLElement>(".sidebar .sidebar-actions")];
      return { count: actions.length, inLayout: actions.filter((a) => getComputedStyle(a).display !== "none").length };
    });
    expect(shape.count).toBeGreaterThanOrEqual(2);
    expect(shape.inLayout).toBeLessThanOrEqual(1);

    expect(await clickLabelled(".sidebar .reader-files", `Pin ${ALPHA}`)).toBe(true);
    await waitInPageWith((name: string) => [...document.querySelectorAll(".sidebar-pinned .sidebar-row-name")].some((n) => n.textContent === name), ALPHA, "the folder never appeared under Pinned");

    const pinned = await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar-pinned .sidebar-pin > .sidebar-row")].map((b) => `${b.querySelector(".sidebar-row-name")?.textContent}|${b.getAttribute("aria-expanded")}`),
    );
    expect(pinned).toEqual([`${ALPHA}|false`]);
    // The row it was pinned from now offers the opposite.
    expect(await browser.execute((l: string) => [...document.querySelectorAll(".sidebar .reader-files button")].some((b) => b.getAttribute("aria-label") === l), `Unpin ${ALPHA}`)).toBe(true);

    const stored = (await browser.execute(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("reader_pins"),
    )) as { display_path: string; kind: string; exists: boolean }[];
    expect(stored.map((p) => `${p.display_path}|${p.kind}|${p.exists}`)).toEqual([`${ALPHA}|dir|true`]);
  });

  it("an opened folder joins Recent as a folder, under the file it opened with and above what was open before, and its row reopens it", async () => {
    // The projects folder, opened above, has no README: it is in Recent on its own.
    expect(await recent()).toEqual(["dir:root"]);

    expect(kinas("open", LOOSE).code).toBe(0);
    await opened(LOOSE);
    expect(kinas("open", ALPHA).code).toBe(0);
    await opened(`${ALPHA}/README.md`);
    expect(await recent()).toEqual(["file:README.md", `dir:${ALPHA}`, `file:${LOOSE}`, "dir:root"]);

    // A file opened on its own closes the folder; the folder stays in Recent, and its row brings it back.
    expect(kinas("open", LOOSE).code).toBe(0);
    await opened(LOOSE);
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".sidebar .reader-files") === null), { timeout: 15000, interval: 250, timeoutMsg: "the Files section never went" });
    expect(await recent()).toEqual([`file:${LOOSE}`, "file:README.md", `dir:${ALPHA}`, "dir:root"]);

    expect(
      await browser.execute((name: string) => {
        const row = [...document.querySelectorAll<HTMLButtonElement>('.sidebar-recent li[data-kind="dir"] .sidebar-row')].find((b) => b.querySelector(".sidebar-row-name")?.textContent === name);
        row?.click();
        return row !== undefined;
      }, ALPHA),
    ).toBe(true);
    await opened(`${ALPHA}/README.md`);
    const files = await browser.execute(() => ({
      label: document.querySelector(".sidebar .reader-files .sidebar-label")?.textContent ?? "",
      current: [...document.querySelectorAll('.sidebar-recent li[data-kind="dir"] .sidebar-row[aria-current="true"] .sidebar-row-name')].map((n) => n.textContent),
    }));
    expect(files.label).toBe(ALPHA);
    expect(files.current).toEqual([ALPHA]);
    expect(await recent()).toEqual(["file:README.md", `dir:${ALPHA}`, `file:${LOOSE}`, "dir:root"]);
  });
});

describe("Open in the terminal", () => {
  let alphaWorkspace = "";
  let firstWorkspace = "";

  before(async () => {
    await browser.keys(["Meta", "2"]);
    await waitForHook("kittyFlags", 45000);
    await browser.waitUntil(async () => (await hook<number>("kittyFlags")) > 0, { timeout: 45000, timeoutMsg: "Herdr never attached" });
  });

  after(() => stopHerdrSession(SESSION));

  it("asks Herdr for the folder's workspace, lands in it on the Work page, and types nothing into the pane", async () => {
    await browser.keys(["Meta", "1"]);
    await browser.waitUntil(() => showing("home"), { timeout: 10000, timeoutMsg: "the Home page never showed" });
    const before = herdrSnapshot(SESSION);
    firstWorkspace = before.focused_workspace_id;
    expect(before.workspaces.some((w) => w.label === ALPHA)).toBe(false);
    const pid = await hook<number>("ptyPid");
    const createdBefore = logLines("reader: folder opened in the terminal (created)").length;

    expect(await clickLabelled(".sidebar-pinned", `Open ${ALPHA} in the terminal`)).toBe(true);
    await browser.waitUntil(() => herdrSnapshot(SESSION).workspaces.some((w) => w.label === ALPHA), { timeout: 20000, timeoutMsg: "Herdr never got a workspace for the folder" });
    await browser.waitUntil(() => showing("work"), { timeout: 10000, timeoutMsg: "the Work page never showed" });
    await browser.waitUntil(() => hook<boolean>("terminalFocused"), { timeout: 10000, timeoutMsg: "the terminal never got the keys" });

    // One workspace, labelled with the folder's path under the projects folder, focused, its pane started in the folder.
    await browser.waitUntil(() => herdrSnapshot(SESSION).panes.some((p) => p.cwd !== null && p.cwd.endsWith(`/${ALPHA}`)), { timeout: 15000, timeoutMsg: "no pane reported the folder as its cwd" });
    const after = herdrSnapshot(SESSION);
    const made = after.workspaces.filter((w) => w.label === ALPHA);
    expect(made).toHaveLength(1);
    alphaWorkspace = made[0]!.workspace_id;
    expect(after.workspaces).toHaveLength(before.workspaces.length + 1);
    expect(after.focused_workspace_id).toBe(alphaWorkspace);
    const panes = after.panes.filter((p) => p.workspace_id === alphaWorkspace);
    expect(panes).toHaveLength(1);
    expect(realpathSync(panes[0]!.cwd!)).toBe(join(root, ALPHA));

    // The PTY was not restarted, and nothing was typed into it: Herdr was asked, the pane was not told.
    expect(await hook<number>("ptyPid")).toBe(pid);
    expect(await hook<string>("terminalText")).not.toMatch(TYPED_CD);
    expect((await recent())[0]).toBe(`dir:${ALPHA}`);

    // The log says that it happened and how long it took, and never which folder.
    expect(logLines("reader: folder opened in the terminal (created)").length).toBeGreaterThan(createdBefore);
    expect(logLines("9c2e")).toEqual([]);
  });

  it("a second click, from another workspace, focuses the folder's workspace and makes nothing", async () => {
    herdr(SESSION, "workspace", "focus", firstWorkspace);
    await browser.waitUntil(() => herdrSnapshot(SESSION).focused_workspace_id === firstWorkspace, { timeout: 10000, timeoutMsg: "Herdr never went back to the first workspace" });
    await browser.keys(["Meta", "1"]);
    await browser.waitUntil(() => showing("home"), { timeout: 10000, timeoutMsg: "the Home page never showed" });
    const before = herdrSnapshot(SESSION);
    const focusedBefore = logLines("reader: folder opened in the terminal (focused)").length;

    // From Recent this time: the same button, wherever the folder shows.
    expect(await clickLabelled(".sidebar-recent", `Open ${ALPHA} in the terminal`)).toBe(true);
    await browser.waitUntil(() => herdrSnapshot(SESSION).focused_workspace_id === alphaWorkspace, { timeout: 20000, timeoutMsg: "the folder's workspace never got the focus back" });
    await browser.waitUntil(() => showing("work"), { timeout: 10000, timeoutMsg: "the Work page never showed" });

    const after = herdrSnapshot(SESSION);
    expect(after.workspaces).toHaveLength(before.workspaces.length);
    expect(after.workspaces.filter((w) => w.label === ALPHA)).toHaveLength(1);
    expect(after.panes).toHaveLength(before.panes.length);
    expect(logLines("reader: folder opened in the terminal (focused)").length).toBeGreaterThan(focusedBefore);
    expect(logLines("9c2e")).toEqual([]);
  });

  it("a folder that has gone is refused in Rust's words — at the foot of the sidebar, the panel being closed — and nothing moves", async () => {
    expect(kinas("open", BETA).code).toBe(0);
    await waitInPageWith((name: string) => [...document.querySelectorAll('.sidebar-recent li[data-kind="dir"] .sidebar-row-name')].some((n) => n.textContent === name), BETA, "the second folder never reached Recent");
    rmSync(join(root, BETA), { recursive: true, force: true });

    await browser.execute(() => document.querySelector<HTMLButtonElement>(".reader-close")!.click());
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".shell")?.getAttribute("data-panel") === "closed"), { timeout: 10000, timeoutMsg: "the reader never closed" });
    await browser.keys(["Meta", "1"]);
    await browser.waitUntil(() => showing("home"), { timeout: 10000, timeoutMsg: "the Home page never showed" });
    const before = herdrSnapshot(SESSION);

    const said = await clickAndReadNotice(".sidebar-recent", `Open ${BETA} in the terminal`, "^No such file: ");
    expect(said).toBe(`No such file: ${join(root, BETA)}`);
    expect(await showing("home")).toBe(true);
    expect(await browser.execute(() => document.querySelector(".shell")?.getAttribute("data-panel"))).toBe("closed");
    expect(herdrSnapshot(SESSION).workspaces).toHaveLength(before.workspaces.length);
  });

  it("with Herdr gone it says so, goes nowhere, and still types nothing", async () => {
    stopHerdrSession(SESSION);
    await browser.pause(1000);
    const said = await clickAndReadNotice(".sidebar-pinned", `Open ${ALPHA} in the terminal`, "Herdr");
    expect(said).toMatch(/^(Herdr isn't running; attach it first|Herdr isn't installed)$/);
    expect(await showing("home")).toBe(true);
    expect(await hook<string>("terminalText")).not.toMatch(TYPED_CD);
  });
});
