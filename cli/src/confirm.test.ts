import { describe, expect, test } from "bun:test";
import { confirm, type Io } from "./confirm.ts";

/** An Io answering from a list; null is the end of input. */
function scripted(answers: (string | null)[]): Io & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: (t) => void written.push(t),
    readLine: async () => (answers.length > 0 ? answers.shift()! : null),
  };
}

describe("confirm, the CLI's one y/N", () => {
  test("y, yes and Y are yes", async () => {
    for (const answer of ["y", "yes", "Y", "YES", "  yes  "]) expect(await confirm("Install?", scripted([answer]))).toBe(true);
  });

  test("an empty line, n, anything else and the end of input are no", async () => {
    for (const answer of ["", "n", "no", "yep", "y es", null]) expect(await confirm("Install?", scripted([answer]))).toBe(false);
  });

  test("asks with [y/N], the default shown as no", async () => {
    const io = scripted(["y"]);
    await confirm("Clone Firstmate?", io);
    expect(io.written).toEqual(["Clone Firstmate? [y/N] "]);
  });
});
