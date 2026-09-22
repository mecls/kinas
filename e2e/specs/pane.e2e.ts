import { browser, $, expect } from "@wdio/globals";
import { hook, processAlive, typeLine, waitForShell, waitForTerminal } from "../helpers.ts";

// AC-8 (Journey D): the pane survives page switches and window hide, reports exits and respawns, keeps
// bytes intact, and never shows a blank pane when WebGL goes away. R28, R33, R34.

async function shellPid(): Promise<number> {
  const marker = `PID_${Date.now()}`;
  await typeLine(`echo ${marker.slice(0, 4)}''${marker.slice(4)}=$$`);
  const text = await waitForTerminal(new RegExp(`^${marker}=(\\d+)\\s*$`, "m"));
  return Number(new RegExp(`^${marker}=(\\d+)\\s*$`, "m").exec(text)![1]);
}

describe("the terminal pane", () => {
  before(async () => {
    await browser.keys(["Meta", "2"]);
    await waitForShell();
  });

  it("keeps the same shell across page switches and a hidden window", async () => {
    const pid = await shellPid();
    await browser.keys(["Meta", "1"]);
    await expect($('section[data-page="home"]')).toBeDisplayed();
    await browser.keys(["Meta", "2"]);
    expect(await shellPid()).toBe(pid);

    await hook("closeWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === false);
    expect(processAlive(pid)).toBe(true);
    await hook("showWindow");
    await browser.waitUntil(async () => (await hook<boolean>("isVisible")) === true);
    expect(await shellPid()).toBe(pid);
    expect(await terminalHasScrollback()).toBe(true);
  });

  it("passes box-drawing and multi-byte characters through intact", async () => {
    await typeLine(String.raw`printf '\342\224\214\342\224\200\342\224\220 \303\247\303\243o \342\234\223\n'`);
    await waitForTerminal(/^┌─┐ ção ✓\s*$/m);
  });

  it("reports an exit and respawns on Enter", async () => {
    const pid = await shellPid();
    await typeLine("exit");
    await waitForTerminal(/\[process exited — press Enter to restart\]/);
    await browser.keys(["Enter"]);
    await waitForShell();
    const next = await shellPid();
    expect(next).not.toBe(pid);
  });

  it("falls back to the DOM renderer with a notice instead of a blank pane", async () => {
    await hook("terminalFallBackToDom");
    await expect($(".terminal-notice")).toBeDisplayed();
    expect(await hook<string>("terminalRenderer")).toBe("dom");
    await typeLine("echo STILL''_ALIVE");
    await waitForTerminal(/^STILL_ALIVE\s*$/m);
  });
});

async function terminalHasScrollback(): Promise<boolean> {
  return (await hook<string>("terminalText")).includes("PID_");
}
