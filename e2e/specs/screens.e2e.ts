import { browser, $, expect } from "@wdio/globals";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Home, Usage and Settings as they ship (build-spec AC-9; DESIGN.md §9: screenshots of every page, in both themes, are
// part of the smoke test). Each page is saved at 1280 × 820 into docs/design/screens/<page>-<theme>.png — the evidence
// a reader looks at, not a pixel diff: WebKit's text rendering is not byte-stable from machine to machine. The
// regression is the style contract: the computed colour, type and geometry of a handful of elements per page, recorded
// on the first run into fixtures/screens/<page>.json and compared on every later one, so a drift names its element.
//
// Reads are one `browser.execute` each: every WebDriver lookup here costs ~5 s (usage.e2e.ts).

const repo = process.cwd();
const screens = join(repo, "docs/design/screens");

type Contract = Record<string, Record<string, string>>;

const PAGES: { page: "home" | "usage" | "settings"; key: string; contract: [selector: string, props: string[]][] }[] = [
  {
    page: "home",
    key: "1",
    contract: [
      ['section[data-page="home"] .ui-titlerow h1', ["font-family", "font-size", "line-height", "font-weight", "color"]],
      ['section[data-page="home"] .ui-titlerow .ui-button[data-kind="primary"]', ["background-color", "color", "height", "border-radius"]],
      ['section[data-page="home"] .ui-plist', ["background-color", "border-top-color", "border-radius"]],
      ['section[data-page="home"] .ui-progress-row', ["min-height", "color"]],
      ['section[data-page="home"] .ui-progress-event', ["color", "font-size"]],
      ['section[data-page="home"] [data-section="waiting"] .ui-empty', ["color", "border-top-style", "background-color"]],
      ['section[data-page="home"] [data-section="usage"] .ui-caption', ["color", "font-size"]],
      ['section[data-page="home"] .ui-gauge', ["background-color", "border-top-color", "border-radius"]],
      ['section[data-page="home"] .ui-gauge .ui-num', ["font-family", "font-size", "font-weight"]],
      ['section[data-page="home"] [data-tone="danger"] .ui-bar i', ["background-color"]],
      ['section[data-page="home"] .ui-rows-title', ["color", "font-size", "font-weight"]],
    ],
  },
  {
    page: "usage",
    key: "4",
    contract: [
      ['section[data-page="usage"] .ui-titlerow h1', ["font-size", "font-weight", "color"]],
      ['section[data-page="usage"] .ui-gauge', ["background-color", "border-top-color", "border-radius", "padding-top"]],
      ['section[data-page="usage"] .ui-gauge .ui-num', ["font-family", "font-size", "line-height"]],
      ['section[data-page="usage"] .ui-section-head h2', ["font-size", "font-weight", "color"]],
      ['section[data-page="usage"] .chart-wrap', ["background-color", "border-top-color", "border-radius"]],
      ['section[data-page="usage"] .legend li', ["color", "font-size"]],
      ['section[data-page="usage"] .ui-table th', ["color", "font-size", "height"]],
      ['section[data-page="usage"] [data-section="convex-month"] .ui-metric-row', ["height", "border-top-color"]],
      ['section[data-page="usage"] [data-section="convex-month"] .ui-rows-title', ["color", "font-size"]],
      ['section[data-page="usage"] [data-section="hostinger"] .ui-card-title', ["font-weight", "color"]],
      ['section[data-page="usage"] .usage-note', ["color", "font-size"]],
    ],
  },
  {
    page: "settings",
    key: ",",
    contract: [
      ['section[data-page="settings"] .ui-titlerow h1', ["font-size", "font-weight", "color"]],
      ['section[data-page="settings"] .settings-section', ["background-color", "border-top-color", "border-radius", "padding-top"]],
      ['section[data-page="settings"] .settings-section h2', ["font-size", "line-height", "font-weight", "color"]],
      ['section[data-page="settings"] .settings-help', ["color", "font-size", "font-family"]],
      ['section[data-page="settings"] .ui-button[data-kind="primary"]', ["background-color", "color", "height"]],
      ['section[data-page="settings"] .ui-button[data-kind="secondary"]', ["background-color", "border-top-color", "color"]],
      ['section[data-page="settings"] .ui-input', ["height", "border-top-color", "border-radius", "background-color"]],
      ['section[data-page="settings"] .shortcut-chord', ["border-top-color", "font-family", "font-size"]],
      ['section[data-page="settings"] .hook-line', ["background-color", "border-radius"]],
      ['section[data-page="settings"] .problem', ["color", "font-family", "font-size"]],
    ],
  },
];

const invoke = (command: string, args: Record<string, unknown> = {}) =>
  browser.execute(
    (cmd: string, a: Record<string, unknown>) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd, a).then(
        () => null,
        (refusal: unknown) => String(refusal),
      ),
    command,
    args,
  );

const ground = () => browser.execute(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

async function theme(value: "light" | "dark", bg: string) {
  expect(await invoke("set_appearance", { value })).toBeNull();
  await browser.waitUntil(async () => (await ground()) === bg, { timeout: 10000, timeoutMsg: `--bg never became ${bg}` });
  // The tokens flipped; let the --dur-fast motion settle before anything is read (stories.e2e.ts learned this).
  await browser.pause(500);
}

/** Presses a chord until its page shows: the first chord after launch can land before the listeners (goToUsage). */
async function show(page: string, key: string) {
  await browser.waitUntil(
    async () => {
      await browser.keys(["Meta", key]);
      return $(`section[data-page="${page}"]`).isDisplayed();
    },
    { timeout: 30000, timeoutMsg: `⌘${key} never showed ${page}` },
  );
  // The top of the page is its hero; a page left scrolled by an earlier shot would hide it.
  await browser.execute(() => {
    for (const el of document.querySelectorAll<HTMLElement>("main.content, section.page")) el.scrollTop = 0;
  });
  await browser.pause(300);
}

const capture = (contract: [string, string[]][]) =>
  browser.execute((pairs: [string, string[]][]) => {
    const out: Record<string, Record<string, string>> = {};
    for (const [selector, props] of pairs) {
      const el = document.querySelector(selector);
      if (!el) {
        out[selector] = { missing: "true" };
        continue;
      }
      const style = getComputedStyle(el);
      out[selector] = Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
    }
    return out;
  }, contract) as Promise<Contract>;

describe("the screens (AC-9)", () => {
  before(async function () {
    this.timeout(240_000);
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await browser.setWindowSize(1280, 820);
    // Every Usage section with its readings: a deployment and a machine against the stubs (usage.e2e.ts).
    expect(await invoke("set_convex_plan", { plan: "starter" })).toBeNull();
    expect(await invoke("set_convex_deployment", { url: "https://happy-otter-123.convex.cloud" })).toBeNull();
    expect(await invoke("set_hostinger_vm", { vmId: 17923, label: "srv17923.hstgr.cloud · KVM 4" })).toBeNull();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll('section[data-page="home"] [data-attention][data-tone="danger"]').length > 0 &&
            document.querySelectorAll('section[data-page="home"] [data-folder]').length === 2 &&
            document.querySelector('section[data-page="usage"] [data-section="convex-month"] .ui-metric-row') !== null &&
            document.querySelector('section[data-page="usage"] [data-section="hostinger"] .ui-card-title') !== null &&
            document.querySelector('section[data-page="usage"] .legend li') !== null,
        ),
      { timeout: 150_000, interval: 1000, timeoutMsg: "the readings never all arrived" },
    );
  });

  for (const { page, key, contract } of PAGES) {
    it(`${page}: saved in both themes, and its style contract holds`, async function () {
      this.timeout(120_000);
      const path = join(repo, `fixtures/screens/${page}.json`);
      const recorded: Record<string, Contract> = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, Contract>) : {};
      const seen: Record<string, Contract> = {};
      mkdirSync(screens, { recursive: true });
      for (const [name, bg] of [
        ["light", "#f4f2ec"],
        ["dark", "#14171e"],
      ] as const) {
        await theme(name, bg);
        await show(page, key);
        seen[name] = await capture(contract);
        for (const [selector, values] of Object.entries(seen[name])) {
          expect(`${selector}: ${values.missing ? "missing" : "present"}`).toBe(`${selector}: present`);
        }
        await browser.saveScreenshot(join(screens, `${page}-${name}.png`));
      }
      if (!recorded.light) {
        mkdirSync(join(repo, "fixtures/screens"), { recursive: true });
        writeFileSync(path, `${JSON.stringify(seen, null, 2)}\n`);
        console.log(`screens.e2e: recorded the style contract into fixtures/screens/${page}.json (${contract.length} elements)`);
      } else {
        for (const name of ["light", "dark"] as const) {
          for (const [selector, values] of Object.entries(seen[name]!)) {
            expect(`${name} ${selector} ${JSON.stringify(values)}`).toBe(`${name} ${selector} ${JSON.stringify(recorded[name]![selector])}`);
          }
        }
      }
    });
  }
});
