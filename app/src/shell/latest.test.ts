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
