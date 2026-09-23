import { browser, $, expect } from "@wdio/globals";
import { hook, waitForHook } from "../helpers.ts";

// AC-3 (build-spec §14; DESIGN.md §5 Home): Kinas lands on Home. Overnight lists the client folders with their chips
// and says nothing ran; Waiting on you says nothing waits; Usage shows the three gauges and Needs attention holds the
// one reading past 95 % as a danger row. ⌘4 and ⌘1 move between Usage and Home, a folder row opens the folder in the
// reader, Launch task hands the terminal the keys — and the PTY never restarts.
//
// Reads are one `browser.execute` each where they can be: every WebDriver lookup here costs ~5 s (usage.e2e.ts).

const home = () =>
  browser.execute(() => {
    const section = (name: string) => document.querySelector(`section[data-page="home"] [data-section="${name}"]`);
    return {
      shown: !(document.querySelector('section[data-page="home"]') as HTMLElement | null)?.hidden,
      folders: Array.from(section("overnight")?.querySelectorAll('[role="option"]') ?? []).map((row) => ({
        name: row.getAttribute("data-folder"),
        cat: row.getAttribute("data-cat"),
        text: row.textContent ?? "",
      })),
      waiting: section("waiting")?.textContent ?? "",
      gauges: Array.from(section("usage")?.querySelectorAll(".ui-gauge") ?? []).map((g) => `${g.getAttribute("data-subscription")}/${g.getAttribute("data-window")}`),
      danger: Array.from(section("usage")?.querySelectorAll('[data-attention][data-tone="danger"]') ?? []).map((r) => r.textContent ?? ""),
      counts: document.querySelectorAll(".sidebar-count").length,
    };
  });

/** Presses a chord until the page shows: the first chord after launch can land before the listeners (goToUsage). */
async function press(key: string, page: string) {
  await browser.waitUntil(
    async () => {
      await browser.keys(["Meta", key]);
      return $(`section[data-page="${page}"]`).isDisplayed();
    },
    { timeout: 30000, timeoutMsg: `⌘${key} never showed ${page}` },
  );
}

describe("Home (AC-3)", () => {
  let pid: number;

  before(async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await waitForHook("ptyPid", 60000);
    pid = await hook<number>("ptyPid");
  });

  it("lands on Home: the two folders with their chips, nothing waiting, and the 97 % reading as the one danger row", async () => {
    // The Claude reading arrives from the hand-off after launch; wait for it rather than for a fixed time.
    await browser.waitUntil(async () => (await home()).danger.length > 0, { timeout: 60000, timeoutMsg: "Needs attention never held a danger row" });
    const seen = await home();
    expect(seen.shown).toBe(true);
    expect(seen.folders.map((f) => f.name).sort()).toEqual(["acme", "globex"]);
    for (const f of seen.folders) expect(f.text).toContain("No work overnight in this folder.");
    expect(new Set(seen.folders.map((f) => f.cat)).size).toBe(2);
    expect(seen.waiting).toContain("Nothing waiting on you.");
    expect(seen.gauges).toEqual(["claude-plan/week", "claude-plan/session", "ollama-cloud/session"]);
    // This Mac's rows are the machine running the test (the host reader samples it, no fixture stands in): a full disk
    // there is a real danger row, so the count is of the fixture's readings.
    const fixtureDanger = seen.danger.filter((row) => !row.startsWith("This Mac"));
    expect(fixtureDanger).toHaveLength(1);
    expect(fixtureDanger[0]).toContain("Claude · session");
    expect(fixtureDanger[0]).toContain("97% used");
    expect(seen.counts).toBe(0);
  });

  it("⌘4 shows Usage and ⌘1 comes back, and the terminal never restarts", async () => {
    await press("4", "usage");
    await press("1", "home");
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("a folder row opens the folder in the reader panel and reads as selected", async () => {
    await browser.execute(() => (document.querySelector('section[data-page="home"] [data-folder="acme"]') as HTMLElement).click());
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector(".shell")?.getAttribute("data-panel") !== "closed" &&
            document.querySelector('section[data-page="home"] [data-folder="acme"]')?.getAttribute("aria-selected") === "true",
        ),
      { timeout: 30000, timeoutMsg: "the folder never opened in the reader" },
    );
    expect(await hook<number>("ptyPid")).toBe(pid);
  });

  it("Launch task goes to the Work page with the terminal holding the keys", async () => {
    await browser.execute(() => {
      const button = Array.from(document.querySelectorAll('section[data-page="home"] .ui-titlerow button')).find((b) => b.textContent === "Launch task");
      (button as HTMLElement).click();
    });
    await $('section[data-page="work"]').waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(async () => hook<boolean>("terminalFocused"), { timeout: 10000, timeoutMsg: "the terminal never got the keys" });
    expect(await hook<number>("ptyPid")).toBe(pid);
  });
});
