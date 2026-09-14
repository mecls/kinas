import { browser, $, $$, expect } from "@wdio/globals";

// AC-2 (Journey A): the Usage page shows the Claude gauges from the status-line hand-off, the Ollama gauges
// from the stub, a 30-day chart that hatches the days before the first transcript, and this Mac.

const gauge = (subscription: string, window: string) => $(`.gauge[data-subscription="${subscription}"][data-window="${window}"]`);

describe("the Usage page", () => {
  it("shows Claude's session and week from the hand-off, fresh, left floored", async () => {
    await gauge("claude-plan", "session").waitForExist({ timeout: 60000 });
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringContaining("58% left"));
    await expect(gauge("claude-plan", "session")).toHaveAttribute("data-state", "fresh");
    // The app takes up to a minute to start under the driver, so the countdown has moved on a little.
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringMatching(/resets in 1 h \d{1,2} m \(\d{2}:\d{2}\)/));
    await expect(gauge("claude-plan", "week")).toHaveText(expect.stringContaining("76% left"));
  });

  it("shows Ollama's session and week from the stub, with no reset time", async () => {
    await gauge("ollama-cloud", "session").waitForExist({ timeout: 60000 });
    await expect(gauge("ollama-cloud", "session")).toHaveText(expect.stringContaining("97% left"));
    await expect(gauge("ollama-cloud", "session")).toHaveText(expect.stringContaining("resets: not reported"));
    await expect(gauge("ollama-cloud", "week")).toHaveText(expect.stringContaining("66% left"));
  });

  it("charts the transcripts and hatches the days before the first one", async () => {
    await browser.waitUntil(async () => (await $$(".legend li")).length === 2, { timeout: 60000, timeoutMsg: "legend never showed both series" });
    const legend = await $$(".legend li").map((li) => li.getText());
    expect(legend).toEqual(["claude-code · claude-opus-5", "pi · glm-5.3:cloud"]);
    expect((await $$("rect[data-nodata]")).length).toBe(26);
    await expect($(".chart-note*=No data before")).toBeDisplayed();
  });

  it("shows this Mac", async () => {
    for (const tile of ["cpu", "memory", "disk"]) {
      await $(`.tile[data-tile="${tile}"]`).waitForExist({ timeout: 30000 });
      await expect($(`.tile[data-tile="${tile}"]`)).toHaveText(expect.stringContaining("as of"));
    }
  });
});
