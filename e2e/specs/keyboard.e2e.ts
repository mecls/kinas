import { browser, expect } from "@wdio/globals";
import { hook, hookWith, typeLine, typeText, waitForShell, waitForTerminal } from "../helpers.ts";

// WebDriver's key actions in the embedded driver send Control as its own keydown and the next key without
// ctrlKey (measured with the terminal's key log), so ⌃-chords are sent as a real keydown on xterm's
// textarea: the same attachCustomKeyEventHandler → decideKey path a physical key takes.
const ctrl = (key: string) => hookWith("dispatchKey", { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), ctrlKey: true });

// AC-7, the parts that need no Herdr: every non-⌘ key reaches the PTY, the app acts only on its ⌘ chords.

describe("the keyboard contract in a plain shell", () => {
  before(async () => {
    await browser.keys(["Meta", "2"]);
    await waitForShell();
  });

  // Every test starts at a clean prompt, so one failure cannot leave `cat` or `sleep` swallowing the next.
  beforeEach(async () => {
    await typeText("\x03");
    await browser.pause(300);
    await waitForShell();
  });

  it("Tab reaches the PTY as ^I and focus stays in the terminal", async () => {
    // `cat -t` shows a tab as ^I (`cat -v` leaves tabs alone).
    await typeLine("cat -t");
    await browser.pause(500);
    await hook("focusTerminal");
    await browser.keys(["Tab"]);
    await typeText("x\r");
    await waitForTerminal(/^\^Ix\s*$/m);
    expect(await hook<boolean>("terminalFocused")).toBe(true);
    await ctrl("d");
  });

  it("⌃C stops a running command", async () => {
    await typeLine("sleep 100");
    await browser.pause(700);
    await ctrl("c");
    await typeLine("echo AFTER''_CTRL_C");
    await waitForTerminal(/^AFTER_CTRL_C\s*$/m, 5000);
  });

  it("⌘K raises the palette action instead of reaching the shell", async () => {
    await browser.execute(() => {
      const w = window as unknown as { __lastAction?: string };
      w.__lastAction = undefined;
      window.addEventListener("kinas:action", (e) => {
        w.__lastAction = (e as CustomEvent<string>).detail;
      });
    });
    await hook("focusTerminal");
    await browser.keys(["Meta", "k"]);
    await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as { __lastAction?: string }).__lastAction)) === "palette", {
      timeoutMsg: "⌘K did not raise the palette action",
    });
    // Nothing reached the shell: the next line runs cleanly.
    await typeLine("echo AFTER''_CMD_K");
    await waitForTerminal(/^AFTER_CMD_K\s*$/m, 5000);
  });

  it("⌘1 and ⌘2 switch pages from inside the terminal", async () => {
    await hook("focusTerminal");
    await browser.keys(["Meta", "1"]);
    await expect($('section[data-page="home"]')).toBeDisplayed();
    await browser.keys(["Meta", "2"]);
    await expect($('section[data-page="work"]')).toBeDisplayed();
  });

  it("⌘S hides and shows the sidebar from inside the terminal, and nothing reaches the shell", async () => {
    await hook("focusTerminal");
    await browser.keys(["Meta", "s"]);
    await expect($(".sidebar")).not.toBeDisplayed();
    await browser.keys(["Meta", "s"]);
    await expect($(".sidebar")).toBeDisplayed();
    await typeLine("echo AFTER''_CMD_S");
    await waitForTerminal(/^AFTER_CMD_S\s*$/m, 5000);
  });
});
