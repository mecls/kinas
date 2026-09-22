import { browser, $, $$, expect } from "@wdio/globals";

// AC-2 (Journey A): the Usage page shows the Claude gauges from the status-line hand-off, the Ollama gauges
// from the stub, a 30-day chart that hatches the days before the first transcript, and this Mac.

const gauge = (subscription: string, window: string) => $(`.gauge[data-subscription="${subscription}"][data-window="${window}"]`);

/** Home is the first screen (keymap.md, 2026-09-22); the gauges live on Usage, ⌘4 away. The first chord after launch
 * can land before the window's listeners are attached, so it is pressed until the page shows. */
async function goToUsage() {
  await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
  await browser.waitUntil(
    async () => {
      await browser.keys(["Meta", "4"]);
      return $('section[data-page="usage"]').isDisplayed();
    },
    { timeout: 30000, timeoutMsg: "⌘4 never showed the Usage page" },
  );
}

describe("the Usage page", () => {
  before(goToUsage);

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
 * Every month gauge's text and state, read in **one** in-page call.
 *
 * Nine `expect($(…))` lookups cost ~5 s each under `@wdio/tauri-service`: `beforeCommand` runs
 * `ensureActiveWindowFocus` before every `findElement`, and on a loaded machine that wait burns its full 5 s
 * and still fails — the run that exposed this logged `core.invoke not available after 5s timeout` continuously
 * from start to finish. That is ~50 s of driver tax to assert about a DOM which is already painted, and it is
 * what pushed this case past mocha's 120 s budget while every figure on screen was correct (the kept store had
 * `functionCalls 250000/1000000 = 25.0` and the two neighbouring cases passed on the same DOM).
 *
 * `browser.execute` skips that hook entirely, so the same nine assertions cost one round-trip. Raising the
 * ceiling instead would have been the third timeout bump in this file — the cost is the thing to remove, not
 * the budget to license. Follows `reader.e2e.ts`, which reads a page's several values in one execute.
 */
const convexMonth = () =>
  browser.execute(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('.gauge[data-provider="convex"][data-window="month"]')).map((el) => [
        (el as HTMLElement).dataset.metric,
        { text: el.textContent ?? "", state: (el as HTMLElement).dataset.state ?? "" },
      ]),
    ),
  ) as Promise<Record<string, { text: string; state: string } | undefined>>;

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

/**
 * Like `call`, but returns what the command resolved with.
 *
 * `call` deliberately throws the value away so a caller can assert "no error"; a command that answers with data
 * needs the data. A rejection surfaces as a WebDriver failure, which is the right shape for a test.
 */
const callValue = <T,>(cmd: string, args: Record<string, unknown>) =>
  browser.execute(
    (c: string, a: Record<string, unknown>) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(c, a),
    cmd,
    args,
  ) as Promise<T>;

describe("Convex usage", () => {
  it("offers Add deploy key and makes no request until a deployment is saved", async () => {
    await $('.gauge-empty[data-provider="convex"]').waitForExist({ timeout: 60000 });
    await expect($('.gauge-empty[data-provider="convex"] .button')).toHaveText("Add deploy key");

    // The tier is stored *here*, not in the next case, and the reason is pacing rather than taste.
    // `set_convex_plan` calls `control.refresh()`, and `poller::MIN_GAP_MS` refuses any request within 60 s of
    // the last one. Saving it next to `set_convex_deployment` therefore burned the poll window on the plan and
    // left the deployment save refused, so the reading could not arrive until the 5-minute cadence tick — past
    // mocha's 120 s budget, which is how that case started failing with a bare Timeout and no assertion.
    //
    // Doing it here is free: with no deployment URL stored, `configured` is false, so this refresh makes no
    // request at all — which the zero-request assertion below now also proves.
    expect(await call("set_convex_plan", { plan: "starter" })).toBeFalsy();
    // R3: no deployment means zero requests, not a request that fails.
    await browser.pause(3000);
    expect(await convexRequests()).toBe(0);
  });

  it("gauges the month against the plan's allowances after the deployment is saved", async () => {
    // The tier was stored in the previous case, deliberately: doing it here burned this case's poll window and
    // left `set_convex_deployment` refused by the 60 s floor. See the comment there.
    //
    // Falsy, not undefined: WebDriver serialises a returned `undefined` as `null`.
    expect(await call("set_convex_deployment", { url: CONVEX_URL })).toBeFalsy();
    await convexMetric("functionCalls").waitForExist({ timeout: 60000 });

    // One in-page read for all nine assertions below; see `convexMonth`. Each `expect($(…))` would cost ~5 s
    // of `ensureActiveWindowFocus` before touching a DOM that `waitForExist` has already proven is painted.
    const month = await convexMonth();

    // Starter's allowances (R6), from fixtures/convex-usage.synthetic.json. The denominator is asserted too,
    // not just the percentage: a wrong tier then fails with the number on screen ("of 25,000,000 calls")
    // instead of as an unexplained percentage mismatch.
    expect(month.functionCalls?.text).toContain("250,000 calls of 1,000,000 calls");
    expect(month.functionCalls?.text).toContain("25% used");
    expect(month.databaseIoGb?.text).toContain("25% used");
    expect(month.dataEgressGb?.text).toContain("50% used");
    // Under 10 % keeps one decimal's worth of precision but drops a trailing zero.
    expect(month.searchQueryGb?.text).toContain("5% used");
    // R7: 1 + 2 + 3 GB-hours of 20, and *not* 16 — queryMutationComputeGbHours is metered separately.
    expect(month.actionCompute?.text).toContain("30% used");
    expect(month.actionCompute?.text).toContain("6 GB-hours of 20 GB-hours");
    expect(month.functionCalls?.state).toBe("fresh");
    // The window names itself as the *calendar* month, not the billing period: Convex bills on a
    // signup-anchored period (e.g. 16 Sep – 16 Oct) and this API reports calendar months only, so the
    // percentage is an upper bound and must not read as "of this billing period" (R4, R6, amended).
    expect(month.functionCalls?.text).toContain("calendar month to date (UTC)");

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

  // `function`, not an arrow, so the mocha timeout can be raised: this case waits on a real poll, and the
  // poller's own cadence is 5 minutes, which no per-test default in this suite comes close to covering.
  it("a rejected deploy key says so and the gauges keep their last numbers", async function () {
    // Bounded by the poller's own constants instead of by a guess at when the 401 will land.
    //
    // A refused `Trigger::Manual` is **dropped, not queued**: `poller::should_request` returns false inside
    // `MIN_GAP_MS` and `convex_loop` moves on. So if this key is saved within 60 s of *any* earlier request —
    // including a `Trigger::Visible` poll that this spec never asked for, which fires once a reading is over
    // `VISIBLE_REFRESH_AGE_MS` old — the rejected poll does not happen until the next `CADENCE_MS` tick, five
    // minutes out. The previous version slept a fixed 61 s and then allowed 90 s, encoding an arrival time it
    // cannot guarantee; it passed once and failed once the suite got faster, and on both runs the kept store
    // showed a correct 401 (`state=error`, `deploy key rejected`, previous figures intact). The assertions are
    // unchanged — only the waiting is now honest about what it is waiting for.
    this.timeout(420_000);
    expect(await call("save_convex_key", { key: "convex-FAKE-wrong-key" })).toBeFalsy();

    // Asserted on the provider's error line, **not** on the reading's `data-state`. A 401 deliberately does not
    // touch `updated_at` (R12), and `stale_after_ms` is 10 minutes — so the gauge stays `fresh`, and waiting for
    // it to go stale would time out however long it was given.
    await $('[data-testid="convex-error"]').waitForExist({ timeout: 330_000 });

    // One in-page read for the three assertions below, for the reason given on `convexMonth`.
    //
    // The first key is `errorLine` and **must not** be called `error`: a W3C WebDriver failure is the envelope
    // `{error, message, stacktrace}`, so wdio reads any returned object carrying an `error` key as a protocol
    // error and re-throws its value as the message. Naming it `error` turned a passing assertion into
    // `WebDriverError: Convex: deploy key rejected · showing the last reading` — the page's own text, surfaced
    // as a driver fault.
    const after = await browser.execute(() => ({
      errorLine: document.querySelector('[data-testid="convex-error"]')?.textContent ?? "",
      functionCalls: document.querySelector('.gauge[data-provider="convex"][data-metric="functionCalls"][data-window="month"]')?.textContent ?? "",
      empties: document.querySelectorAll('.gauge-empty[data-provider="convex"]').length,
    }));
    expect(after.errorLine).toContain("deploy key rejected");
    // R12: the stored numbers stand, and the gauges are still gauges rather than an empty state.
    expect(after.functionCalls).toContain("25% used");
    expect(after.empties).toBe(0);

    // Put the real key back, so a later spec in this file is not left broken.
    expect(await call("save_convex_key", { key: convexKey })).toBeFalsy();
  });
});

// Hostinger (prd-hostinger-usage.md §5). The token is seeded from the Keychain at launch, but no VPS is
// selected — and the reader refuses to request anything without one, whatever the base-URL override says. So
// "no requests yet" is asserted first, then a machine is chosen and the tile appears.

const vpsStub = process.env.KINAS_E2E_HOSTINGER_STUB!;
const vpsRequests = async () => ((await (await fetch(`${vpsStub}/__hostinger_count`)).json()) as { requests: number }).requests;

describe("Hostinger VPS", () => {
  it("makes no request until a VPS is chosen, then shows the machine as a tile", async function () {
    // The poll lands within seconds — this reader has never requested, so `MIN_GAP_MS` cannot refuse its first
    // Manual trigger — but the budget covers a slow machine and the driver's per-lookup cost.
    this.timeout(180_000);

    // R4: a saved token is not enough. With no VPS selected, `configured` is false and nothing is requested —
    // which is also what proves the debug base-URL override decides only *where* a request goes, not whether.
    await browser.pause(3000);
    expect(await vpsRequests()).toBe(0);

    // The picker's own command, exercised against the stub: it lists both machines and stores nothing.
    const choices = await callValue<{ id: number; hostname: string; state: string }[]>("hostinger_list_vms", {});
    expect(choices.map((c) => c.id)).toEqual([17923, 18044]);
    expect(choices[1]!.state).toBe("stopped");

    expect(await call("set_hostinger_vm", { vmId: 17923, label: "srv17923.hstgr.cloud · KVM 4" })).toBeFalsy();
    await $('[data-section="hostinger-tile"] .tile[data-metric="ram"]').waitForExist({ timeout: 90000 });

    // One in-page read for every assertion below, for the reason given on `convexMonth`.
    const vps = await browser.execute(() => {
      const tile = (metric: string) => document.querySelector(`.tile[data-metric="${metric}"]`)?.textContent ?? "";
      return {
        cpu: tile("cpu"),
        ram: tile("ram"),
        disk: tile("disk"),
        uptime: tile("uptime"),
        bandwidth: document.querySelector('.gauge[data-provider="hostinger"][data-metric="bandwidth"]')?.textContent ?? "",
        bars: document.querySelectorAll('.gauge[data-provider="hostinger"] .gauge-fill').length,
        caveat: document.querySelector('[data-testid="hostinger-billing-window"]')?.textContent ?? "",
      };
    });

    // The fixture's numbers, in binary units against binary denominators (R7). 529 MiB and not 554 176 512,
    // and "of 8.0 GiB" and not "of 8192" — the pair has to add up on screen.
    expect(vps.ram).toContain("529 MiB");
    expect(vps.ram).toContain("of 8.0 GiB");
    expect(vps.disk).toContain("2.4 GiB");
    expect(vps.disk).toContain("of 50.0 GiB");
    expect(vps.cpu).toContain("13%");
    expect(vps.uptime).toContain("14 d 0 h");
    // The tile names its machine, including a power state, from the row's own detail — no second lookup.
    expect(vps.ram).toContain("srv17923.hstgr.cloud · KVM 4 · running");

    // R10: the month's traffic is a **figure**, not a bar, until the delta-versus-counter question is settled.
    // Both directions summed is 4 TiB of the fixture's traffic; the absent bar is the point of the assertion.
    expect(vps.bandwidth).toContain("4.00 TiB");
    expect(vps.bars).toBe(0);
    expect(vps.caveat).toContain("does not report when the monthly allowance resets");

    // Three requests in total, and each one is accounted for: the picker's own list call above, then R2's two
    // per poll — the list for the denominators and the metrics for the usage. Not four: there is no
    // per-machine details call, because that endpoint returns the same fields the list already gave.
    expect(await vpsRequests()).toBe(3);
  });
});
