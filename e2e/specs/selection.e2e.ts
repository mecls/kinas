import { browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { hook, hookWith, terminalText, typeLine, typeText, waitForShell, waitForTerminal } from "../helpers.ts";

// Selection and clipboard in the pane: copies reach the macOS clipboard, and ⌫ removes a selection at the prompt.
// The spec reads and writes the real clipboard, so it saves it first and puts it back at the end.

const utf8 = { ...process.env, LANG: "en_US.UTF-8" };
const pbpaste = () => execFileSync("/usr/bin/pbpaste", { encoding: "utf8", env: utf8 });
const pbcopy = (text: string) => void execFileSync("/usr/bin/pbcopy", { input: text, env: utf8 });
const clipboardBecomes = (text: string) =>
  browser.waitUntil(() => pbpaste() === text, { timeout: 5000, timeoutMsg: `the clipboard never read ${JSON.stringify(text)}; it reads ${JSON.stringify(pbpaste())}` });

interface Cursor {
  x: number;
  row: number;
  viewportY: number;
}

/** The absolute buffer row of the last line that reads exactly `text`. */
async function rowOf(text: string): Promise<number> {
  const row = (await terminalText()).split("\n").lastIndexOf(text);
  if (row < 0) throw new Error(`no terminal line reads ${JSON.stringify(text)}`);
  return row;
}

/** The viewport point at the middle of a cell, from xterm's screen box. */
async function cellPoint(column: number, row: number): Promise<{ x: number; y: number }> {
  const { viewportY } = await hook<Cursor>("terminalCursor");
  const { cols, rows } = await hook<{ cols: number; rows: number }>("terminalSize");
  const box = await browser.execute(() => {
    const r = document.querySelector(".xterm-screen")!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  return { x: box.left + (column + 0.5) * (box.width / cols), y: box.top + (row - viewportY + 0.5) * (box.height / rows) };
}

/**
 * A left-button drag from the left edge of `from` to the right edge of `to - 1`, as DOM mouse events: the same
 * listeners a physical drag reaches (xterm's, and the pane's copy on release). WebDriver pointer actions reach the page
 * in the embedded driver, but xterm makes no selection from them (task 1.5). So this does not prove the OS
 * delivers the mouse; the smoke test's physical drag does.
 */
async function drag(row: number, from: number, to: number): Promise<void> {
  const start = await cellPoint(from, row);
  const end = await cellPoint(to - 1, row);
  const cellWidth = (end.x - start.x) / Math.max(1, to - 1 - from);
  await browser.execute(
    (x0: number, x1: number, y: number) => {
      const screen = document.querySelector(".xterm-screen")!;
      const init = (x: number, buttons: number): MouseEventInit => ({ bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons, detail: 1 });
      screen.dispatchEvent(new MouseEvent("mousedown", init(x0, 1)));
      document.dispatchEvent(new MouseEvent("mousemove", init((x0 + x1) / 2, 1)));
      document.dispatchEvent(new MouseEvent("mousemove", init(x1, 1)));
      document.dispatchEvent(new MouseEvent("mouseup", init(x1, 0)));
    },
    start.x - 0.45 * (Number.isFinite(cellWidth) ? cellWidth : 8),
    end.x + 0.45 * (Number.isFinite(cellWidth) ? cellWidth : 8),
    start.y,
  );
}

const backspace = () => hookWith("dispatchKey", { key: "Backspace", code: "Backspace", keyCode: 8 });

/** The pane's "copied to clipboard" toast, or null when none is up. */
const toastText = () => browser.execute(() => document.querySelector(".terminal-toast")?.textContent?.trim() ?? null);
const toastShows = (why: string) =>
  browser.waitUntil(async () => (await toastText()) === "copied to clipboard", { timeout: 3000, timeoutMsg: `no "copied to clipboard" toast ${why}` });

describe("selection and clipboard in a plain shell", () => {
  let saved = "";

  before(async () => {
    saved = pbpaste();
    await browser.keys(["Meta", "2"]);
    await waitForShell();
  });

  // Every test starts at a clean prompt, so one failure cannot leave a half-typed line for the next.
  beforeEach(async () => {
    await typeText("\x03");
    await browser.pause(300);
    await waitForShell();
  });

  after(() => pbcopy(saved));

  it("the clipboard command writes the macOS clipboard", async () => {
    pbcopy("BEFORE");
    const result = await browser.executeAsync((done: (v: unknown) => void) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      internals.invoke("clipboard_write_text", { text: "ção ✓" }).then(
        () => done("ok"),
        (e: unknown) => done(String(e)),
      );
    });
    expect(result).toBe("ok");
    expect(pbpaste()).toBe("ção ✓");
  });

  it("a program's OSC 52 write reaches the clipboard", async () => {
    pbcopy("BEFORE");
    // Typed as ASCII: the payload is base64 of "ção ✓".
    await typeLine(`printf '\\e]52;c;%s\\a' '${Buffer.from("ção ✓", "utf8").toString("base64")}'`);
    await clipboardBecomes("ção ✓");
    // Herdr shows its own toast for the copies it sends this way, so the pane stays quiet.
    expect(await toastText()).toBeNull();
  });

  it("an OSC 52 query never reads the clipboard and types nothing back", async () => {
    pbcopy("KEEP");
    await typeLine("printf '\\e]52;c;?\\a'; echo QUERY''_DONE");
    await waitForTerminal(/^QUERY_DONE\s*$/m);
    await browser.pause(500);
    // A reply typed into the prompt would turn the next command into garbage.
    await typeLine("echo AFTER''_QUERY");
    await waitForTerminal(/^AFTER_QUERY\s*$/m);
    expect(pbpaste()).toBe("KEEP");
  });

  it("a mouse selection is copied when the button is released", async () => {
    pbcopy("BEFORE");
    await typeLine("echo clm''efes");
    await waitForTerminal(/^clmefes\s*$/m);
    await drag(await rowOf("clmefes"), 0, 7);
    expect(await hook<string>("terminalSelection")).toBe("clmefes");
    await clipboardBecomes("clmefes");
    await toastShows("after a mouse copy");
    // In the lower part of the pane, at the right, clear of a prompt typed from the left.
    const place = await browser.execute(() => {
      const toast = document.querySelector(".terminal-toast")!.getBoundingClientRect();
      const pane = document.querySelector(".terminal")!.getBoundingClientRect();
      return { inLowerHalf: toast.top > pane.top + pane.height / 2, fromBottom: pane.bottom - toast.bottom, fromRight: pane.right - toast.right };
    });
    expect(place.inLowerHalf).toBe(true);
    expect(place.fromBottom).toBeLessThan(40);
    expect(place.fromRight).toBeLessThan(40);
    // COPIED_TOAST_MS is 3 s since the design system (DESIGN.md §4 Toast; it was 1.5 s), so the wait for it to go allows 8.
    await browser.waitUntil(async () => (await toastText()) === null, { timeout: 8000, timeoutMsg: "the toast never went away" });
  });

  it("⌘C over a selection says copied to clipboard", async () => {
    await typeLine("echo tost''ed");
    await waitForTerminal(/^tosted\s*$/m);
    await hookWith("terminalSelect", { column: 0, row: await rowOf("tosted"), length: 6 });
    // The macOS menu's Copy reaches the terminal as a copy event on xterm's focused textarea.
    await browser.execute(() => {
      const target = document.querySelector(".xterm-helper-textarea") ?? document.querySelector(".xterm")!;
      const event = typeof ClipboardEvent === "function" ? new ClipboardEvent("copy", { bubbles: true, cancelable: true }) : new Event("copy", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    });
    await toastShows("after ⌘C");
  });

  it("⌫ removes the selection from the line being typed", async () => {
    await typeText("clmefes");
    await browser.waitUntil(async () => (await terminalText()).split("\n").some((l) => l.endsWith("% clmefes")), { timeout: 5000 });
    const cursor = await hook<Cursor>("terminalCursor");
    const start = cursor.x - 7;
    await hookWith("terminalSelect", { column: start, row: cursor.row, length: 2 });
    // xterm's selection columns are 0-based with the end exclusive, whatever its doc comment says.
    expect(await hook("terminalSelectionPosition")).toEqual({ start: { x: start, y: cursor.row }, end: { x: start + 2, y: cursor.row } });
    await backspace();
    expect(await hook<string>("terminalSelection")).toBe("");
    await typeText("\r");
    await waitForTerminal(/command not found: mefes/);
  });

  it("⌫ over a selection in a full-screen program is an ordinary ⌫", async () => {
    // On the alternate screen the shell's history is gone: the page shows less's two lines and no earlier marker.
    await typeLine("printf 'ALT''_ONE\\nALT''_TWO\\n' | less");
    await browser.waitUntil(
      async () => {
        const text = await terminalText();
        return /^ALT_ONE\s*$/m.test(text) && !text.includes("READY_");
      },
      { timeout: 5000, timeoutMsg: "less never showed its page on the alternate screen" },
    );
    await browser.pause(500);
    const cursor = await hook<Cursor>("terminalCursor");
    await hookWith("terminalSelect", { column: 0, row: cursor.row, length: 1 });
    await backspace();
    const decisions = (await hook<string>("keyLog")).split("\n").filter((l) => l.startsWith("keydown Backspace"));
    expect(decisions.at(-1)).toContain('→ {"kind":"xterm"}');
    await typeText("q");
    await browser.pause(500);
  });
});
