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

// Convex (prd-convex-usage.md §5). The deploy key is already in the memory Keychain from launch, but the
// deployment URL is not stored — and the reader refuses to make a request without one, whatever the base-URL
// override says. So "no requests yet" is asserted first, then the URL is saved and the gauges appear.

const convexStub = process.env.KINAS_E2E_CONVEX_STUB!;
const convexKey = process.env.KINAS_E2E_CONVEX_KEY!;
const convexRequests = async () => ((await (await fetch(`${convexStub}/__convex_count`)).json()) as { requests: number }).requests;
const convexMetric = (metric: string, window = "month") => $(`.gauge[data-provider="convex"][data-metric="${metric}"][data-window="${window}"]`);

/**
 * A deployment URL that passes R3's rule. The stub is plain HTTP on localhost and `set_convex_deployment`
 * refuses anything but `https://` — rightly, since that rule is what a real deployment needs. So the *stored*
 * URL is a plausible one and `KINAS_CONVEX_BASE_URL` routes the request to the stub: the override decides where
 * a request goes, the stored setting decides whether one happens at all.
 */
const CONVEX_URL = "https://happy-otter-123.convex.cloud";

/** Calls a command the way settings.e2e.ts does; returns the error text, or null/undefined on success. */
const call = (cmd: string, args: Record<string, unknown>) =>
  browser.execute(
    (c: string, a: Record<string, unknown>) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
        .invoke(c, a)
        .then(
          () => undefined,
          (e: unknown) => String(e),
        ),
    cmd,
    args,
  );

describe("Convex usage", () => {
  it("offers Add deploy key and makes no request until a deployment is saved", async () => {
    await $('.gauge-empty[data-provider="convex"]').waitForExist({ timeout: 60000 });
    await expect($('.gauge-empty[data-provider="convex"] .button')).toHaveText("Add deploy key");
    // R3: no deployment means zero requests, not a request that fails.
    await browser.pause(3000);
    expect(await convexRequests()).toBe(0);
  });

  it("gauges the month against the plan's allowances after the deployment is saved", async () => {
    // Set the tier explicitly rather than trusting an unset default to mean Starter. Asserting Starter's
    // numbers while never storing Starter made a failure unreadable once already: a run's store turned up with
    // `convex_plan = "professional"` and every limit gauged against Professional (25,000,000 calls instead of
    // 1,000,000), and nothing in the tree accounts for that write. A test that owns the value it asserts cannot
    // be undermined that way, whatever the cause turns out to have been.
    expect(await call("set_convex_plan", { plan: "starter" })).toBeFalsy();
    // Falsy, not undefined: WebDriver serialises a returned `undefined` as `null`.
    expect(await call("set_convex_deployment", { url: CONVEX_URL })).toBeFalsy();
    await convexMetric("functionCalls").waitForExist({ timeout: 60000 });

    // Starter's allowances (R6), from fixtures/convex-usage.synthetic.json. The denominator is asserted too,
    // not just the percentage: a wrong tier then fails with the number on screen ("of 25,000,000 calls")
    // instead of as an unexplained percentage mismatch.
    await expect(convexMetric("functionCalls")).toHaveText(expect.stringContaining("250,000 calls of 1,000,000 calls"));
    await expect(convexMetric("functionCalls")).toHaveText(expect.stringContaining("25% used"));
    await expect(convexMetric("databaseIoGb")).toHaveText(expect.stringContaining("25% used"));
    await expect(convexMetric("dataEgressGb")).toHaveText(expect.stringContaining("50% used"));
    // Under 10 % keeps one decimal's worth of precision but drops a trailing zero.
    await expect(convexMetric("searchQueryGb")).toHaveText(expect.stringContaining("5% used"));
    // R7: 1 + 2 + 3 GB-hours of 20, and *not* 16 — queryMutationComputeGbHours is metered separately.
    await expect(convexMetric("actionCompute")).toHaveText(expect.stringContaining("30% used"));
    await expect(convexMetric("actionCompute")).toHaveText(expect.stringContaining("6 GB-hours of 20 GB-hours"));
    await expect(convexMetric("functionCalls")).toHaveAttribute("data-state", "fresh");
    // The window names itself as the *calendar* month, not the billing period: Convex bills on a
    // signup-anchored period (e.g. 16 Sep – 16 Oct) and this API reports calendar months only, so the
    // percentage is an upper bound and must not read as "of this billing period" (R4, R6, amended).
    await expect(convexMetric("functionCalls")).toHaveText(expect.stringContaining("calendar month to date (UTC)"));

    // R11: one request per poll window, not one per render.
    expect(await convexRequests()).toBe(1);
  });

  it("lists today's figures, the metrics with no allowance, and what this API cannot report", async () => {
    const detail = $('[data-section="convex-detail"]');
    await detail.waitForExist({ timeout: 30000 });
    await expect(detail).toHaveText(expect.stringContaining("today (UTC)"));
    await expect(detail).toHaveText(expect.stringContaining("12,000 calls"));
    // R8: a cost has no denominator, so it is a figure and never a gauge.
    await expect(detail).toHaveText(expect.stringContaining("$4.20"));
    expect(await $$('.gauge[data-provider="convex"][data-metric="aiGatewayCostDollars"]')).toHaveLength(0);
    // The reason the month percentage is an upper bound is on screen, not buried in a comment.
    await expect($('[data-testid="convex-billing-window"]')).toHaveText(expect.stringContaining("upper bound"));
    // R15: said plainly, once, instead of placeholder gauges.
    await expect(detail).toHaveText(expect.stringContaining("not in this API"));
  });

  // `function`, not an arrow, so the mocha timeout can be raised: the 61 s wait below plus a 60 s poll wait
  // exceeds the suite's 120 s per-test budget, and the first version of this test could not finish at all.
  it("a rejected deploy key says so and the gauges keep their last numbers", async function () {
    this.timeout(200_000);
    // poller::MIN_GAP_MS is 60 s with no override, so a manual refresh inside the minute is refused by design.
    // Waiting it out is the only honest way to observe a second poll — without this the next request never
    // happens and the assertion below would pass for the wrong reason.
    await browser.pause(61_000);
    expect(await call("save_convex_key", { key: "convex-FAKE-wrong-key" })).toBeFalsy();

    // Asserted on the provider's error line, **not** on the reading's `data-state`. A 401 deliberately does not
    // touch `updated_at` (R12), and `stale_after_ms` is 10 minutes — so the gauge stays `fresh`, and waiting for
    // it to go stale would time out however long it was given.
    await $('[data-testid="convex-error"]').waitForExist({ timeout: 90000 });
    await expect($('[data-testid="convex-error"]')).toHaveText(expect.stringContaining("deploy key rejected"));

    // R12: the stored numbers stand, and the gauges are still gauges rather than an empty state.
    await expect(convexMetric("functionCalls")).toHaveText(expect.stringContaining("25% used"));
    expect(await $$('.gauge-empty[data-provider="convex"]')).toHaveLength(0);

    // Put the real key back, so a later spec in this file is not left broken.
    expect(await call("save_convex_key", { key: convexKey })).toBeFalsy();
  });
});
