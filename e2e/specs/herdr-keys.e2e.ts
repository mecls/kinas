import { browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { herdr, herdrSnapshot, hook, hookWith, processCommand, stopHerdrSession, terminalText, waitForHook } from "../helpers.ts";

// AC-7: ⌃Tab and ⌃⇧Tab cycle Herdr panes through Kinas (task 1.5's kitty CSI u encoding), and the
// automated input goes only to the throwaway session.

const SESSION = "kinas-e2e";

describe("⌃Tab through the pane to Herdr", () => {
  // No cleanup here: the app, and the pane attaching the session, start before this hook runs.
  // Leftover sessions are removed by herdr-keys.setup.ts, before the app launches.
  before(async () => {
    await browser.keys(["Meta", "2"]);
    await waitForHook("kittyFlags", 45000);
    const explain = async (what: string) => {
      const sessions = (() => {
        try {
          return execFileSync("herdr", ["session", "list"], { encoding: "utf8" });
        } catch (e) {
          return String(e);
        }
      })();
      return `${what}\nflags=${await hook("kittyFlags")}\n--- herdr session list ---\n${sessions}\n--- terminal text ---\n${(await terminalText()).slice(-800)}`;
    };
    // Herdr pushes kitty flags when it attaches.
    await browser
      .waitUntil(async () => (await hook<number>("kittyFlags")) > 0, { timeout: 45000 })
      .catch(async () => {
        throw new Error(await explain("Herdr never enabled the kitty keyboard protocol in the pane"));
      });
  });

  after(() => stopHerdrSession(SESSION));

  it("the pane runs the throwaway session, not default", async () => {
    const pid = await hook<number>("ptyPid");
    expect(processCommand(pid)).toContain(`herdr session attach ${SESSION}`);
  });

  it("⌃Tab and ⌃⇧Tab move focus between Herdr panes", async () => {
    const before = herdrSnapshot(SESSION);
    herdr(SESSION, "pane", "split", before.focused_pane_id, "--direction", "right");
    await browser.waitUntil(() => herdrSnapshot(SESSION).panes.length === 2, { timeoutMsg: "split did not happen" });

    const focusMoves = async (from: string) => {
      try {
        await browser.waitUntil(() => herdrSnapshot(SESSION).focused_pane_id !== from, { timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    };

    // First with WebDriver's keys. If the embedded driver drops the Ctrl modifier, prove the same path
    // with a real keydown on xterm's textarea, which runs attachCustomKeyEventHandler and decideKey
    // exactly as a physical key does. A real keyboard check stays on Miguel's list either way.
    for (const [label, mods] of [
      ["⌃Tab", { ctrlKey: true, shiftKey: false }],
      ["⌃⇧Tab", { ctrlKey: true, shiftKey: true }],
    ] as const) {
      const from = herdrSnapshot(SESSION).focused_pane_id;
      await hook("focusTerminal");
      await browser.keys(mods.shiftKey ? ["Control", "Shift", "Tab"] : ["Control", "Tab"]);
      if (await focusMoves(from)) {
        console.log(`${label}: moved Herdr's focus via WebDriver keys`);
        continue;
      }
      console.log(`${label}: WebDriver keys did not move focus; key log:\n${await hook<string>("keyLog")}`);
      await hookWith("dispatchKey", { key: "Tab", code: "Tab", keyCode: 9, ...mods });
      if (!(await focusMoves(from))) {
        throw new Error(`${label} did not move Herdr's focus by either path\n--- key log ---\n${await hook<string>("keyLog")}`);
      }
      console.log(`${label}: moved Herdr's focus via a dispatched keydown`);
    }
  });
});
