import { browser, $, expect } from "@wdio/globals";

// AC-4 (Journey C): old numbers are marked, never faked. A reading dated by an idle session is stale, a window
// past its reset hides its number, and a rate-limited Ollama keeps its manners — one request, no retry storm.

const stub = process.env.KINAS_E2E_STUB_URL!;
const stubRequests = async () => ((await (await fetch(`${stub}/__count`)).json()) as { requests: number }).requests;
const gauge = (subscription: string, window: string) => $(`.gauge[data-subscription="${subscription}"][data-window="${window}"]`);

describe("numbers that are no longer true", () => {
  it("dates the Claude reading by the session's last response, so it is stale", async () => {
    await gauge("claude-plan", "session").waitForExist({ timeout: 60000 });
    await expect(gauge("claude-plan", "session")).toHaveAttribute("data-state", "stale");
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringContaining("50% left"));
    await expect(gauge("claude-plan", "session")).toHaveText(expect.stringMatching(/as of \d{2}:\d{2} · stale/));
  });

  it("hides the number of a window whose reset has passed", async () => {
    await expect(gauge("claude-plan", "week")).toHaveAttribute("data-state", "reset");
    await expect(gauge("claude-plan", "week").$(".gauge-number")).toHaveText("—");
    await expect(gauge("claude-plan", "week")).toHaveText(expect.stringContaining("waiting for a new reading"));
  });

  it("shows a rate-limited Ollama as such, after exactly one request", async () => {
    const card = $('.gauge-empty[data-subscription="ollama-cloud"]');
    await card.waitForExist({ timeout: 60000 });
    await expect(card).toHaveAttribute("data-state", "dead");
    await expect(card).toHaveText(expect.stringContaining("rate limited (HTTP 429)"));
    expect(await stubRequests()).toBe(1);
  });

  it("does not ask again when readings are refreshed during the backoff", async () => {
    await browser.keys(["Meta", "k"]);
    await $('[data-command="refresh"]').click();
    await expect($(".palette")).not.toBeExisting();
    await browser.pause(5000);
    expect(await stubRequests()).toBe(1);
  });
});
