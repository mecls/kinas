import { $, browser, expect } from "@wdio/globals";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { APP_LOG, fakeHome, herdr, herdrSnapshot, logLines, stopHerdrSession, terminalText } from "../helpers.ts";

// The first mate in the pane (build spec AC-16, AC-2; §6.16, §6.18): Kinas focuses an existing `firstmate` workspace once
// at start and never again unasked; Launch makes one in Firstmate's home and runs `claude` there (a stand-in named
// claude); First mate focuses it and makes no second; with Herdr stopped the sidebar says so. Nothing is typed into
// Kinas's own pane. In `kinas-e2e-crew`, never `default`.

const SESSION = "kinas-e2e-crew";
const dataDir = process.env.KINAS_DATA_DIR!;
const argvLog = join(dataDir, "standin", "argv.log");
const logFrom = Number(process.env.KINAS_E2E_LOG_FROM ?? "0");
/** A `cd` to an absolute path, typed or pasted: what the launcher must never put in Kinas's pane. */
const TYPED_CD = /\bcd\s+['"]?\//;

/** This run's log lines that contain `needle`: the log is shared by every run of Kinas. */
function runLog(needle: string): string[] {
  if (!existsSync(APP_LOG)) return [];
  return readFileSync(APP_LOG).subarray(logFrom).toString("utf8").split("\n").filter((l) => l.includes(needle));
}

const focusedLabel = () => {
  const s = herdrSnapshot(SESSION);
  return s.workspaces.find((w) => w.workspace_id === s.focused_workspace_id)?.label ?? null;
};
const firstMates = () => herdrSnapshot(SESSION).workspaces.filter((w) => w.label === "firstmate");
const standInRuns = () => (existsSync(argvLog) ? readFileSync(argvLog, "utf8").trim().split("\n").filter(Boolean) : []);

const invoke = <T>(command: string) =>
  browser.execute(
    (cmd: string) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd).then(
        (value) => ({ ok: value }),
        (r: unknown) => ({ refused: String(r) }),
      ),
    command,
  ) as Promise<{ ok?: T; refused?: string }>;

/** A click in the page on a sidebar row by its text. */
const go = (label: string) =>
  browser.execute((l: string) => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim() === l)!.click(), label);

/** Clicks the Crew page's title-row button once the page reads `state`. */
async function clickCrewButton(state: "installed" | "running", label: string) {
  await go("Crew");
  await browser.waitUntil(
    () =>
      browser.execute(
        (s: string, l: string) => {
          const b = [...document.querySelectorAll<HTMLButtonElement>(`section[data-page="crew"] .crew[data-crew="${s}"] .ui-titlerow button`)].find((x) => x.textContent === l);
          if (!b) return false;
          b.click();
          return true;
        },
        state,
        label,
      ),
    { timeout: 30000, interval: 500, timeoutMsg: `the Crew page never offered ${label} (${state})` },
  );
}

const workShowing = () => browser.waitUntil(() => browser.execute(() => !document.querySelector<HTMLElement>('section[data-page="work"]')!.hidden), { timeout: 20000, timeoutMsg: "the Work page never showed" });

describe("the first mate in the pane", () => {
  it("AC-16: focuses the first mate's workspace once at start, and nothing after", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await browser.waitUntil(async () => focusedLabel() === "firstmate", { timeout: 15000, interval: 500, timeoutMsg: "the first mate's workspace was never focused at start" });
    expect(runLog("crew: focused the first mate at start").length).toBe(1);
    // The captain moves elsewhere by hand; Kinas moves nothing back without a click.
    const elsewhere = herdrSnapshot(SESSION).workspaces.find((w) => w.label === "elsewhere")!.workspace_id;
    herdr(SESSION, "workspace", "focus", elsewhere);
    await browser.pause(60000);
    expect(focusedLabel()).toBe("elsewhere");
    expect(runLog("crew: focused the first mate at start").length).toBe(1);
  });

  it("AC-2: Launch makes one workspace in Firstmate's home, runs the first mate there, and hands the Work page the keys", async () => {
    // Close the workspace setup made, so Launch has none to find, and have Kinas look again as Refresh readings does: the
    // Crew page's own trigger needs a window the webview reports visible, and this test app runs in the background.
    herdr(SESSION, "workspace", "close", firstMates()[0]!.workspace_id);
    expect((await invoke("refresh_readings")).refused).toBeUndefined();
    const pid = (await invoke<number>("pty_pid")).ok;
    await clickCrewButton("installed", "Launch the first mate");
    await workShowing();
    await browser.waitUntil(async () => standInRuns().length === 1, { timeout: 15000, timeoutMsg: "the stand-in never ran" });
    const made = firstMates();
    expect(made.length).toBe(1);
    const snap = herdrSnapshot(SESSION);
    const pane = snap.panes.find((p) => p.workspace_id === made[0]!.workspace_id)!;
    expect(realpathSync(pane.cwd!)).toBe(realpathSync(fakeHome()));
    expect(focusedLabel()).toBe("firstmate");
    const fg = JSON.parse(herdr(SESSION, "pane", "process-info", "--pane", pane.pane_id)) as { result: { process_info: { foreground_processes: { argv0: string }[] } } };
    expect(fg.result.process_info.foreground_processes.map((p) => p.argv0)).toContain("claude");
    expect(standInRuns()).toEqual(["0"]);
    expect(runLog("crew: launched (created)").length).toBe(1);
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.closest(".terminal") !== null), { timeout: 10000, timeoutMsg: "the terminal never took the keys" });
    expect((await invoke<number>("pty_pid")).ok).toBe(pid);
    const text = await terminalText();
    expect(text).not.toMatch(TYPED_CD);
  });

  it("First mate, from another workspace, focuses it and makes no second", async () => {
    const elsewhere = herdrSnapshot(SESSION).workspaces.find((w) => w.label === "elsewhere")!.workspace_id;
    herdr(SESSION, "workspace", "focus", elsewhere);
    await clickCrewButton("running", "First mate");
    await workShowing();
    await browser.waitUntil(async () => focusedLabel() === "firstmate", { timeout: 10000, timeoutMsg: "First mate never focused its workspace" });
    expect(firstMates().length).toBe(1);
    expect(standInRuns()).toEqual(["0"]);
    await browser.waitUntil(async () => runLog("crew: launched (focused)").length === 1, { timeout: 10000, timeoutMsg: "no launched (focused) line" });
  });

  it("with Herdr's server stopped, the sidebar says so and nothing moves", async () => {
    stopHerdrSession(SESSION);
    await clickCrewButton("running", "First mate");
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".sidebar-notice")?.textContent ?? ""), {
      timeout: 15000,
      timeoutMsg: "no notice",
    });
    const notice = await browser.execute(() => document.querySelector(".sidebar-notice")?.textContent ?? "");
    expect(notice).toContain("Herdr isn't running; attach it first");
    expect(standInRuns()).toEqual(["0"]);
  });

  it("logs nothing about the crew", async () => {
    expect(logLines("9c2e")).toEqual([]);
  });
});
