import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Runs the real worker file against a stand-in `self`: what a push shows, what a tap opens.
const code = readFileSync(join(import.meta.dir, "public", "sw.js"), "utf8");

function worker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const state = { windows: [] as { focus: () => unknown; navigate?: (u: string) => void }[] };
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn),
    registration: { showNotification: (title: string, options: Record<string, unknown>) => (shown.push({ title, options }), Promise.resolve()) },
    clients: { matchAll: () => Promise.resolve(state.windows), openWindow: (u: string) => (opened.push(u), Promise.resolve()) },
  };
  new Function("self", code)(self);
  const push = async (data: unknown) => {
    let waited: Promise<unknown> = Promise.resolve();
    handlers.push!({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  };
  const click = async (url: unknown) => {
    let waited: Promise<unknown> = Promise.resolve();
    let closed = false;
    handlers.notificationclick!({ notification: { close: () => (closed = true), data: { url } }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    return closed;
  };
  return { handlers, shown, opened, navigated, state, push, click };
}

test("a push shows its title and body, tagged and addressed by its item", async () => {
  const w = worker();
  await w.push({ title: "shop · Stock webhook", body: "Keep the CSV import?", url: "/#item=fix%40a%401" });
  expect(w.shown).toEqual([{ title: "shop · Stock webhook", options: { body: "Keep the CSV import?", data: { url: "/#item=fix%40a%401" }, tag: "/#item=fix%40a%401", icon: "/icon-256.png" } }]);
});

test("anything else in a push is ignored, a title and body are cut and made plain, and an address off the page is Home", async () => {
  const w = worker();
  await w.push({ title: `${"t".repeat(300)}\nx`, body: `${"b".repeat(300)}\u0007`, url: "https://evil.example/", answer: "MIT", token: "secret" });
  const s = w.shown[0]!;
  expect(s.title).toHaveLength(200);
  expect((s.options.body as string).length).toBe(120);
  expect(s.options.data).toEqual({ url: "/" });
  expect(JSON.stringify(s)).not.toContain("MIT");
  expect(JSON.stringify(s)).not.toContain("secret");
  await w.push({ url: "/#item=<script>" });
  expect(w.shown[1]).toMatchObject({ title: "Kinas", options: { data: { url: "/" } } });
  await w.push(null as unknown);
  expect(w.shown[2]!.title).toBe("Kinas");
});

test("a tap closes the notification and opens the page at its address, or focuses a window already open", async () => {
  const w = worker();
  expect(await w.click("/#item=a%40a%401")).toBe(true);
  expect(w.opened).toEqual(["/#item=a%40a%401"]);
  let focused = 0;
  const went: string[] = [];
  w.state.windows = [{ focus: () => void focused++, navigate: (u) => void went.push(u) }];
  await w.click("/#item=b%40b%401");
  expect(went).toEqual(["/#item=b%40b%401"]);
  expect(focused).toBe(1);
  expect(w.opened).toHaveLength(1);
  w.state.windows = [];
  await w.click("https://evil.example/");
  expect(w.opened.at(-1)).toBe("/");
});

test("the worker caches nothing and answers no fetch", () => {
  const live = code.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  expect(live).not.toMatch(/caches|addEventListener\("fetch"|importScripts|sync/);
});
