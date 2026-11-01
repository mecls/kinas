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

  test("a live reload of an open image reads it as an image, as its open did — never as text", () => {
    // reader_read_text refuses an image's bytes ("Not a text file: …/chart.png"): a PNG saved over kept its old picture
    // under that line, and an SVG's reload redrew the same element, so neither ever showed the new file.
    const handler = /onReaderChanged\(async \(\{ path \}\) => \{([\s\S]*?)\n    \}\);\n/.exec(src("reader/Reader.tsx"))![1]!;
    const image = handler.indexOf('current.render === "image"');
    expect(image).toBeGreaterThan(-1);
    expect(image).toBeLessThan(handler.indexOf("readerReadText"));
    expect(handler.slice(image, handler.indexOf("readerReadText"))).toMatch(/unlessSuperseded\(reloads, \(\) => readerReadImage\(path\)\)/);
    // Positive control: text still reloads through the same counter.
    expect(handler).toMatch(/unlessSuperseded\(reloads, \(\) => readerReadText\(path\)\)/);
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

  test("a click on the view already showing is a request too: Changes or the crew's copy on its way does not land over it", () => {
    // Rendered pressed while Changes is out (Rendered still reads pressed), or Changes pressed while the crew's copy is:
    // both returned before counting, so the older click's answer landed after the captain's last one.
    const body = /const changeView = \(next: View\) => \{([\s\S]*?)\n  \};\n/.exec(src("reader/Reader.tsx"))![1]!;
    expect(body.slice(0, body.indexOf('if (next === "changes")'))).toMatch(/viewAsk\.current\+\+;/);
    // Positive control: the usual view's own door counts as well.
    expect(src("reader/Reader.tsx")).toMatch(/const leaveChanges = \(current: Doc\) => \{\s*viewAsk\.current\+\+;/);
  });

  test("Changes pressed while a save lands: a diff begun before the save is asked again for the text on screen", () => {
    // The live reload, begun on the usual view, draws the new text first; the diff, read from the file before the save,
    // then landed over it and showed the old changes under the new text until the next save.
    const body = /const enterChanges = async \(current: Doc\) => \{([\s\S]*?)\n  \};\n/.exec(src("reader/Reader.tsx"))![1]!;
    expect(body.slice(0, body.indexOf("setChangesOn("))).toMatch(/if \(latest\.hash !== current\.hash\) return void enterChanges\(latest\);/);
  });

  test("an open overtaken while it says \"Opening …\" takes its line with it, whatever overtook it", () => {
    // A slow `kinas open plan.md`, then a click on a folder with no README: the folder opened, and "Opening plan.md…"
    // stayed under the header for good, in place of "Choose a file" (or beside a refused click's reason).
    const body = /async function show\(([\s\S]*?)\n    \/\/ openFolder is hoisted below/.exec(src("reader/Reader.tsx"))![1]!;
    const owner = /openingOf\.current = gen;\s*setOpening\(baseName\(path\)\);/;
    expect(body).toMatch(owner);
    expect(body.slice(body.lastIndexOf("} finally {"))).toMatch(/if \(openingOf\.current === gen\) setOpening\(null\);/);
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

describe("the reader swaps in every document it is handed", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const reader = readFileSync(join(import.meta.dir, "..", "reader/Reader.tsx"), "utf8");

  test("each document drawn is set after its own swap, with nothing between that could take the swap first", () => {
    // The layout effect swaps the body only for a `pending` it finds, and clears it. Set before an await, another draw in
    // the meantime — a live reload of the file showing — took it: a marked row clicked while the open file was saved
    // showed the new file's header over the old file's text. Not set at all, the body kept what it had: a crew row
    // whose crew pushed kept the crew's diff, "not pushed", in place of "No changes by the crew any more".
    const draws = [...reader.matchAll(/setDoc\((?!null)/g)].map((m) => m.index!);
    const lineOf = (at: number) => reader.slice(0, at).split("\n").length;
    const unswapped = draws
      .filter((at) => {
        const swap = reader.lastIndexOf("pending.current = {", at);
        const between = reader.slice(swap, at);
        return swap < 0 || /\bawait\b/.test(between) || /setDoc\(/.test(between);
      })
      .map(lineOf);
    expect(unswapped).toEqual([]);
    // Positive control: the guard reads real draws — the opens, the reload, the three view changes and the two rows.
    expect(draws.length).toBeGreaterThanOrEqual(9);
  });

  test("a file that stops showing takes its sticky line with it: nothing is \"showing the last version\" any more", () => {
    // plan.md removed (the sticky "plan.md was removed; showing the last version"), then a folder with no README, a
    // refused tab or a file that cannot be shown took the page: the line stayed above "Choose a file" or the reason.
    const gone = [...reader.matchAll(/docRef\.current = null;/g)].map((m) => m.index!);
    const lineOf = (at: number) => reader.slice(0, at).split("\n").length;
    const kept = gone.filter((at) => !reader.slice(at, at + 400).split("\n").slice(0, 6).join("\n").includes("setStatus((s) => (s?.sticky ? null : s));")).map(lineOf);
    expect(kept).toEqual([]);
    expect(gone.length).toBe(3);
    // Positive control: a file that opens clears it the same way.
    expect(reader).toMatch(/setProblem\(null\);\s*setOpening\(null\);\s*setStatus\(\(s\) => \(s\?\.sticky \? null : s\)\);/);
  });
});
