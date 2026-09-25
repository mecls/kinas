import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, herdr, herdrSnapshot } from "../helpers.ts";

// Add to crew (build spec AC-17; ADR 0017, §6.11): on a client folder's right-click, with the first mate stopped the
// launcher starts it with ADR 0017's sentence as its one argument; running, the sentence goes on the clipboard and its
// pane is focused, and nothing is typed there; a folder with no remote has the item disabled with its reason; a remote
// with a quote is refused and nothing launches. In `kinas-e2e-crew`, never `default`.

const SESSION = "kinas-e2e-crew";
const dataDir = process.env.KINAS_DATA_DIR!;
const standIn = join(dataDir, "standin");
const clipboardFile = join(dataDir, "clipboard.txt");
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
const SENTENCE = "Add the project https://github.com/o/alpha-9c2e to the crew: clone it from GitHub, not from my desk, and ask me which mode it ships in.";

const runs = () => (existsSync(join(standIn, "argv.log")) ? readFileSync(join(standIn, "argv.log"), "utf8").trim().split("\n").filter(Boolean) : []);
const stdin = () => (existsSync(join(standIn, "stdin.log")) ? readFileSync(join(standIn, "stdin.log"), "utf8") : "");
const clipboard = () => (existsSync(clipboardFile) ? readFileSync(clipboardFile, "utf8") : null);
const runLog = (needle: string) =>
  existsSync(APP_LOG) ? readFileSync(APP_LOG).subarray(logFrom).toString("utf8").split("\n").filter((l) => l.includes(needle)) : [];
const firstMates = () => herdrSnapshot(SESSION).workspaces.filter((w) => w.label === "firstmate");
const focusedLabel = () => {
  const s = herdrSnapshot(SESSION);
  return s.workspaces.find((w) => w.workspace_id === s.focused_workspace_id)?.label ?? null;
};

async function waitInPage(condition: () => boolean, timeoutMsg: string, timeout = 30000) {
  await browser.waitUntil(() => browser.execute(condition), { timeout, interval: 250, timeoutMsg });
}

/** Right-clicks a client folder's row and returns Add to crew's state: its label, whether disabled, and why. */
async function openMenu(name: string): Promise<{ disabled: boolean; reason: string | null }> {
  await waitInPage(() => document.querySelector(".sidebar-folders li") !== null, "no client folders in the sidebar");
  await browser.execute((n: string) => {
    const li = [...document.querySelectorAll<HTMLElement>(".sidebar-folders li")].find((x) => x.querySelector(".ui-nav-label")?.textContent === n)!;
    const r = li.getBoundingClientRect();
    li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 4 }));
  }, name);
  await browser.waitUntil(() => browser.execute((n: string) => document.querySelector(`.sidebar-menu [role="menu"][aria-label="${n}"]`) !== null, name), {
    timeout: 10000,
    timeoutMsg: `the menu for ${name} never opened`,
  });
  return JSON.parse(
    (await browser.execute(() => {
      const item = [...document.querySelectorAll('.sidebar-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === "Add to crew")!;
      return JSON.stringify({ disabled: item.getAttribute("aria-disabled") === "true", reason: item.getAttribute("title") });
    })) as string,
  );
}

const choose = () => browser.execute(() => ([...document.querySelectorAll('.sidebar-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === "Add to crew") as HTMLElement).click());

/** Add to crew's flow ends on the Work page with the terminal holding the keys. */
const onWork = () => waitInPage(() => !document.querySelector('section[data-page="work"]')!.hasAttribute("hidden"), "Add to crew never ended on the Work page");

describe("Add to crew", () => {
  it("AC-17: stopped, the first mate starts with the sentence as its one argument", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    // The Crew page reads the install once, so the menu knows Firstmate is there.
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim().startsWith("Crew"))!.click());
    await waitInPage(() => document.querySelector('section[data-page="crew"] .crew[data-crew="installed"]') !== null, "the Crew page never read as installed");
    expect(firstMates()).toEqual([]);
    expect(await openMenu("alpha-9c2e")).toEqual({ disabled: false, reason: null });
    await choose();
    await browser.waitUntil(() => runs().length === 1, { timeout: 20000, timeoutMsg: "the stand-in never started" });
    expect(runs()).toEqual([`1 ${SENTENCE}`]);
    expect(firstMates()).toHaveLength(1);
    await onWork();
    expect(runLog("crew: added (launched) in ").length).toBe(1);
  });

  it("AC-17: running, the sentence goes on the clipboard, the pane is focused, and nothing is typed there", async () => {
    await browser.waitUntil(() => focusedLabel() === "firstmate", { timeout: 15000, timeoutMsg: "the first mate was not focused after its launch" });
    herdr(SESSION, "workspace", "focus", herdrSnapshot(SESSION).workspaces.find((w) => w.label === "elsewhere")!.workspace_id);
    // The stand-in has taken the pane: the launcher now sees `claude` in the foreground.
    await browser.pause(1500);
    expect(await openMenu("alpha-9c2e")).toEqual({ disabled: false, reason: null });
    await choose();
    await browser.waitUntil(() => clipboard() === SENTENCE, { timeout: 15000, timeoutMsg: `the sentence never reached the clipboard; it holds ${clipboard()}` });
    await browser.waitUntil(() => focusedLabel() === "firstmate", { timeout: 15000, timeoutMsg: "the first mate's pane was never focused" });
    await waitInPage(() => document.body.textContent?.includes("The ask is on the clipboard — paste it into the first mate's pane.") === true, "the notice never said what to paste");
    await onWork();
    expect(runs()).toHaveLength(1);
    expect(firstMates()).toHaveLength(1);
    expect(stdin()).toBe("");
    expect(runLog("crew: added (copied) in ").length).toBe(1);
  });

  it("no remote: the item is there, disabled, and says why", async () => {
    expect(await openMenu("plain-9c2e")).toEqual({ disabled: true, reason: "No GitHub remote" });
    await browser.keys("Escape");
  });

  it("a remote with a quote is refused, and nothing is launched", async () => {
    for (const w of firstMates()) herdr(SESSION, "workspace", "close", w.workspace_id);
    const before = { runs: runs().length, clipboard: clipboard() };
    expect(await openMenu("quote-9c2e")).toEqual({ disabled: false, reason: null });
    await choose();
    await waitInPage(() => document.body.textContent?.includes("Its GitHub remote has characters the first mate's sentence cannot carry") === true, "the refusal was never said");
    await browser.pause(1000);
    expect({ runs: runs().length, clipboard: clipboard() }).toEqual(before);
    expect(firstMates()).toEqual([]);
    for (const needle of ["alpha-9c2e", "al'pha", "Add the project"]) expect(runLog(needle)).toEqual([]);
  });
});
