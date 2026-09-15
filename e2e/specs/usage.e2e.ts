import { browser, $, $$, expect } from "@wdio/globals";

// AC-2 (Journey A): the Usage page shows the Claude gauges from the status-line hand-off, the Ollama gauges
// from the stub, a 30-day chart that hatches the days before the first transcript, and this Mac.

const gauge = (subscription: string, window: string) => $(`.gauge[data-subscription="${subscription}"][data-window="${window}"]`);

describe("the Usage page", () => {
  it("shows Claude's session and week from the hand-off, fresh, as % used like Claude's /usage", async () => {
    await gauge("claude-plan", "session").waitForExist({ timeout: 60000 });
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringContaining("42% used"));
    await expect(gauge("claude-plan", "session")).toHaveAttribute("data-state", "fresh");
    // The app takes up to a minute to start under the driver, so the countdown has moved on a little; after
    // 22:00 the reset is tomorrow and the clock carries the date.
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringMatching(/resets in 1 h \d{1,2} m \((\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}\)/));
    await expect(gauge("claude-plan", "week")).toHaveText(expect.stringContaining("24% used"));
  });

  it("shows Ollama's session and week as % used, like ollama.com, with no reset time", async () => {
    await gauge("ollama-cloud", "session").waitForExist({ timeout: 60000 });
    await expect(gauge("ollama-cloud", "session")).toHaveText(expect.stringContaining("2.5% used"));
    await expect(gauge("ollama-cloud", "session")).toHaveText(expect.stringContaining("resets: not reported"));
    await expect(gauge("ollama-cloud", "week")).toHaveText(expect.stringContaining("34% used"));
  });

  it("lists Ollama's requests per model under each window, busiest first", async () => {
    await expect(gauge("ollama-cloud", "session").$('li[data-model="glm-5.3:cloud"]')).toHaveText(expect.stringContaining("12 requests"));
    const week = await gauge("ollama-cloud", "week").$$(".gauge-models li").map((li) => li.getAttribute("data-model"));
    expect(week).toEqual(["glm-5.3:cloud", "gpt-oss:120b"]);
    await expect(gauge("ollama-cloud", "week").$('li[data-model="gpt-oss:120b"]')).toHaveText(expect.stringContaining("9 requests"));
  });

  it("charts the transcripts and hatches the days before the first one", async () => {
    await browser.waitUntil(async () => (await $$(".legend li")).length === 2, { timeout: 60000, timeoutMsg: "legend never showed both series" });
    const legend = await $$(".legend li").map((li) => li.getText());
    expect(legend).toEqual(["claude-code · claude-opus-5", "pi · glm-5.3:cloud"]);
    expect((await $$("rect[data-nodata]")).length).toBe(26);
    await expect($(".chart-note*=No data before")).toBeDisplayed();
  });

  it("shows this Mac, with disk space in Finder's GB", async () => {
    for (const tile of ["cpu", "memory", "disk"]) {
      await $(`.tile[data-tile="${tile}"]`).waitForExist({ timeout: 30000 });
      await expect($(`.tile[data-tile="${tile}"]`)).toHaveText(expect.stringContaining("as of"));
    }
    await expect($('.tile[data-tile="disk"]')).toHaveText(expect.stringMatching(/\d+(\.\d)? GB[\s\S]*available of \d+ GB · \d+(\.\d)? GB free now/));
  });
});
