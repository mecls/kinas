import { $, browser, expect } from "@wdio/globals";
import { herdr, herdrSnapshot, logLines } from "../helpers.ts";

// The Work page's chrome says only what is known (build spec AC-18, §4 Work): on the first mate's pane the session and
// `firstmate`, `claude`, no badge; on a worker's pane its tab label `fm-<id>`, its task's word as the badge, and the
// task's harness. From Herdr's view, every 5 s while the Work page shows. The plain shell's form is crew-collector's.

const SESSION = "kinas-e2e-crew";

/** The chrome's three parts, read in the page and handed back as JSON text: this driver returns null for an object with a
 * key named `session` (found here), as it mangles one named `error`. */
const chrome = async () =>
  JSON.parse(
    await browser.execute(() => {
      const c = document.querySelector('section[data-page="work"] .ui-termchrome');
      return JSON.stringify({
        session: c?.querySelector(".ui-termchrome-session")?.textContent ?? null,
        badge: c?.querySelector(".ui-badge")?.textContent ?? null,
        profile: c?.querySelector(".ui-ink2")?.textContent ?? null,
      });
    }),
  ) as { session: string | null; badge: string | null; profile: string | null };

async function chromeReads(want: { session: string; badge: string | null; profile: string | null }) {
  let last: unknown = null;
  await browser.waitUntil(
    async () => {
      last = await chrome();
      return JSON.stringify(last) === JSON.stringify(want);
    },
    { timeout: 30000, interval: 500, timeoutMsg: `the chrome never read ${JSON.stringify(want)}; last ${JSON.stringify(last)}` },
  );
}

const focus = (label: string) => {
  const ws = herdrSnapshot(SESSION).workspaces.find((w) => w.label === label)!;
  herdr(SESSION, "workspace", "focus", ws.workspace_id);
};

describe("the Work page's chrome", () => {
  it("on the first mate's pane: the session and firstmate, claude, no badge", async () => {
    await $('section[data-page="home"]').waitForDisplayed({ timeout: 60000 });
    await browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((b) => b.textContent?.trim() === "Work")!.click());
    focus("firstmate");
    await chromeReads({ session: `${SESSION} · firstmate`, badge: null, profile: "claude" });
  });

  it("on a worker's pane: its tab label, its task's word and harness", async () => {
    focus("└ shop-health-9c2e · p:e2e");
    await chromeReads({ session: `${SESSION} · fm-shop-health-9c2e`, badge: "working", profile: "claude" });
  });

  it("logs nothing about the crew", async () => {
    expect(logLines("9c2e")).toEqual([]);
  });
});
