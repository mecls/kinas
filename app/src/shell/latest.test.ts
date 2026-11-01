import { describe, expect, test } from "bun:test";
import { latestOnly } from "./latest.ts";

// Two reads of the same snapshot can be in flight at once — the 30 s timer's and a `crew_changed` event's — and Tauri
// does not promise they finish in the order they began. The one that began last is the one whose answer counts.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("latestOnly: a read that lands after a newer one began is dropped", () => {
  test("an older answer never overwrites a newer one", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const answers = [first, second];
    const delivered: string[] = [];
    const read = latestOnly(() => answers.shift()!.promise, (v) => delivered.push(v));
    read();
    read();
    second.resolve("new");
    await tick();
    first.resolve("old");
    await tick();
    expect(delivered).toEqual(["new"]);
  });

  test("answers that land in order are both delivered, in order", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const answers = [first, second];
    const delivered: number[] = [];
    const read = latestOnly(() => answers.shift()!.promise, (v) => delivered.push(v));
    read();
    first.resolve(1);
    await tick();
    read();
    second.resolve(2);
    await tick();
    expect(delivered).toEqual([1, 2]);
  });

  test("a failure of a superseded read is not reported either; the newest read's is", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const answers = [first, second];
    const failures: string[] = [];
    const delivered: number[] = [];
    const read = latestOnly(
      () => answers.shift()!.promise,
      (v) => delivered.push(v),
      (e) => failures.push(String(e)),
    );
    read();
    read();
    first.reject(new Error("old failure"));
    await tick();
    second.reject(new Error("new failure"));
    await tick();
    expect(delivered).toEqual([]);
    expect(failures).toEqual(["Error: new failure"]);
  });
});

describe("unlessSuperseded: one step of a request a later one can supersede", () => {
  test("a step that lands after a later request began is dropped, answer and failure alike", async () => {
    const { unlessSuperseded } = await import("./latest.ts");
    const counter = { current: 0 };
    const slow = deferred<string>();
    const slowFail = deferred<string>();
    const first = unlessSuperseded(counter, () => slow.promise);
    const second = unlessSuperseded(counter, () => slowFail.promise);
    const third = unlessSuperseded(counter, () => Promise.resolve("newest"));
    slow.resolve("old folder");
    slowFail.reject(new Error("old refusal"));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(await third).toEqual({ value: "newest" });
  });

  test("the newest step's failure is the caller's to say", async () => {
    const { unlessSuperseded } = await import("./latest.ts");
    const counter = { current: 0 };
    await expect(unlessSuperseded(counter, () => Promise.reject(new Error("gone")))).rejects.toThrow("gone");
  });

  test("anything else that moves the counter on supersedes it too (the reader's × and its other opens)", async () => {
    const { unlessSuperseded } = await import("./latest.ts");
    const counter = { current: 0 };
    const listing = deferred<number>();
    const step = unlessSuperseded(counter, () => listing.promise);
    counter.current++;
    listing.resolve(3);
    expect(await step).toBeNull();
  });
});

describe("who reads through it", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8");

  test("Settings: a read begun before a change never lands over the one begun after it", () => {
    // get_settings waits on three Keychain calls, so two reads in flight can finish in either order.
    expect(src("pages/Settings.tsx")).toMatch(/latestOnly\(\s*getSettings,/);
    // Positive control: the usage poller is written the same way.
    expect(src("usage/useUsageSnapshot.ts")).toMatch(/latestOnly\(\s*getUsageSnapshot,/);
  });

  test("the reader: a click's door, a folder's listing and a live reload each yield to a later one", () => {
    const reader = src("reader/Reader.tsx");
    expect(reader).toMatch(/unlessSuperseded\(generation, \(\) => readerAllowClick\(path\)\)/);
    expect(reader).toMatch(/unlessSuperseded\(generation, \(\) => readerListDir\(path\)\)/);
    expect(reader).toMatch(/unlessSuperseded\(reloads, \(\) => readerReadText\(path\)\)/);
  });

  test("the reader's view toggle: a later click on Changes, the crew's copy or the usual view wins over an earlier one", () => {
    const reader = src("reader/Reader.tsx");
    expect(reader).toMatch(/unlessSuperseded\(viewAsk, \(\) => changesOf\(current\.path\)\)/);
    expect(reader).toMatch(/unlessSuperseded\(viewAsk, \(\) => crewChangesOf\(current\.path\)\)/);
    // Back to the usual view is a request too, though it reads nothing: it supersedes one on its way.
    expect(reader).toMatch(/const leaveChanges = \(current: Doc\) => \{\s*viewAsk\.current\+\+;/);
    // A live reload draws what the view is once its diff is in, not what it was when it began (changes.ts reloadDraws).
    expect(reader).toMatch(/reloadDraws\(since, \{ changes: changesRef\.current, crew: crewRef\.current \}, diffed !== null\)/);
  });

  test("the confirmation card's Open: a click made while the door is out is what the captain asked for last", () => {
    expect(src("reader/Reader.tsx")).toMatch(/unlessSuperseded\(generation, \(\) => readerConfirm\(pendingPath, true\)\)/);
  });

  test("a folder that cannot be listed, with nothing showing, says why on the page — not in a line that fades", () => {
    const body = /async function openFolder\(path: string\) \{([\s\S]*?)\n  \}\n/.exec(src("reader/Reader.tsx"))![1]!;
    const handler = body.slice(body.lastIndexOf("} catch (e) {"));
    expect(handler).toMatch(/if \(!docRef\.current && !folderRef\.current\) setProblem\(/);
    // Positive control: a click's own refusal is written the same way (follow).
    expect(src("reader/Reader.tsx")).toMatch(/else if \(!docRef\.current && !folderRef\.current\) setProblem\(\{ displayPath: baseName\(path\), message \}\);/);
  });

  test("Settings: a new projects folder reads the client folders again, as every other folder change does", () => {
    const settings = src("pages/Settings.tsx");
    expect(settings).toMatch(/setProjectsRoot\(value\)\.then\(onProjectsChange\)/);
    expect(settings).toMatch(/setFolderHidden\(f\.path, hidden\)\.then\(onProjectsChange\)/);
  });
});
