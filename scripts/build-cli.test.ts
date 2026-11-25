import { describe, expect, test } from "bun:test";
import { DEFAULT_OUT, parseArgs } from "./build-cli.ts";

describe("build-cli's arguments (build spec §12 slice 4.1)", () => {
  test("no arguments: the app bundle's arm64 sidecar, as before", () => {
    expect(parseArgs([])).toEqual({ target: "bun-darwin-arm64", outfile: DEFAULT_OUT["bun-darwin-arm64"] });
    expect(parseArgs(["src-tauri/binaries/kinas-cli-aarch64-apple-darwin"])).toEqual({
      target: "bun-darwin-arm64",
      outfile: "src-tauri/binaries/kinas-cli-aarch64-apple-darwin",
    });
  });

  test("--target picks a Linux build, named as the release attaches it unless an outfile is given", () => {
    expect(parseArgs(["--target", "bun-linux-x64"])).toEqual({ target: "bun-linux-x64", outfile: "dist/kinas-linux-x64" });
    expect(parseArgs(["out/k", "--target", "bun-linux-arm64"])).toEqual({ target: "bun-linux-arm64", outfile: "out/k" });
  });

  test("anything else is refused, with what it takes", () => {
    expect(parseArgs(["--target", "bun-windows-x64"])).toEqual({ error: "--target takes one of bun-darwin-arm64, bun-linux-x64, bun-linux-arm64" });
    expect(parseArgs(["--target"])).toHaveProperty("error");
    expect(parseArgs(["--minify"])).toEqual({ error: "unknown option --minify" });
    expect(parseArgs(["a", "b"])).toEqual({ error: "one outfile at most" });
  });
});
