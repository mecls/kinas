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
      // The interface polish (rule 27): quiet folders share one line; each is a link with its chip and name.
      folders: Array.from(section("overnight")?.querySelectorAll("[data-folder]") ?? []).map((row) => ({
        name: row.getAttribute("data-folder"),
        cat: row.getAttribute("data-cat"),
        text: row.textContent ?? "",
      })),
      quiet: section("overnight")?.querySelector('[data-testid="home-quiet"]')?.textContent ?? null,
      rows: section("overnight")?.querySelectorAll('[role="option"]').length ?? 0,
      waiting: section("waiting")?.textContent ?? "",
      gauges: Array.from(section("usage")?.querySelectorAll(".ui-gauge") ?? []).map((g) => `${g.getAttribute("data-subscription")}/${g.getAttribute("data-window")}`),
      danger: Array.from(section("usage")?.querySelectorAll('[data-attention][data-tone="danger"]') ?? []).map((r) => r.textContent ?? ""),
      attention: Array.from(section("usage")?.querySelectorAll("[data-attention]") ?? []).map((r) => r.getAttribute("data-attention")),
      session: section("usage")?.querySelector('.ui-gauge[data-subscription="claude-plan"][data-window="session"] .ui-bar')?.getAttribute("data-tone") ?? null,
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

  it("lands on Home: the two quiet folders in one line, nothing waiting, and the 97 % on its gauge, not repeated below", async () => {
    // The Claude reading arrives from the hand-off after launch; wait for it rather than for a fixed time.
    await browser.waitUntil(async () => (await home()).session === "danger", { timeout: 60000, timeoutMsg: "Claude's session gauge never read danger" });
    const seen = await home();
    expect(seen.shown).toBe(true);
    // Rule 27: no folder has work overnight, so the one line is the whole section, the two folders in it.
    expect(seen.rows).toBe(0);
    expect(seen.quiet).toBe("No work overnight inacmeglobex");
    expect(seen.folders.map((f) => f.name).sort()).toEqual(["acme", "globex"]);
    expect(new Set(seen.folders.map((f) => f.cat)).size).toBe(2);
    expect(seen.waiting).toContain("Nothing waiting on you.");
    expect(seen.gauges).toEqual(["claude-plan/week", "claude-plan/session", "ollama-cloud/session"]);
    // Rule 28: Needs attention never repeats a gauge. This Mac's rows are the machine running the test (the host reader
    // samples it), so only the fixture's readings are counted: none of the three gauges is listed again.
    const fixtureRows = seen.attention.filter((key) => !(key ?? "").startsWith("host/"));
    expect(fixtureRows).not.toContain("claude-plan/session");
    expect(fixtureRows).not.toContain("claude-plan/week");
    expect(fixtureRows).not.toContain("ollama-cloud/session");
    expect(fixtureRows).toContain("ollama-cloud/week");
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
            document.querySelector('section[data-page="home"] [data-folder="acme"]')?.getAttribute("aria-current") === "true",
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
