// Compiles the kinas CLI into one binary: for the app bundle (Tauri externalBin, arm64 macOS, the default), or for a
// Linux machine's companion (the factory in the cloud, build spec §12 slice 4.1), which the release attaches (§16).
//
//   bun scripts/build-cli.ts [--target bun-darwin-arm64|bun-linux-x64|bun-linux-arm64] [<outfile>]
//
// Ink imports react-devtools-core only when React DevTools is wanted (DEV=true and the package installed). It is
// not a dependency, so the compiler is given an empty module for it instead of failing to resolve it.

import { resolve } from "node:path";

export const TARGETS = ["bun-darwin-arm64", "bun-linux-x64", "bun-linux-arm64"] as const;
export type Target = (typeof TARGETS)[number];

/** Where each target's binary goes when no outfile is given: the bundle's sidecar, or the release's asset name. */
export const DEFAULT_OUT: Record<Target, string> = {
  "bun-darwin-arm64": "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin",
  "bun-linux-x64": "dist/kinas-linux-x64",
  "bun-linux-arm64": "dist/kinas-linux-arm64",
};

/** The target and the outfile from the arguments, or why they are not usable. */
export function parseArgs(args: string[]): { target: Target; outfile: string } | { error: string } {
  let target: Target = "bun-darwin-arm64";
  let outfile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--target") {
      const value = args[++i];
      if (!TARGETS.includes(value as Target)) return { error: `--target takes one of ${TARGETS.join(", ")}` };
      target = value as Target;
    } else if (arg.startsWith("-")) {
      return { error: `unknown option ${arg}` };
    } else if (outfile === null) {
      outfile = arg;
    } else {
      return { error: "one outfile at most" };
    }
  }
  return { target, outfile: outfile ?? DEFAULT_OUT[target] };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`build-cli: ${parsed.error}`);
    process.exit(64);
  }
  const outfile = resolve(process.cwd(), parsed.outfile);
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../cli/src/main.ts")],
    compile: { target: parsed.target, outfile },
    plugins: [
      {
        name: "no-react-devtools",
        setup(build) {
          build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: "react-devtools-core", namespace: "kinas-empty" }));
          build.onLoad({ filter: /.*/, namespace: "kinas-empty" }, () => ({ contents: "export default {};", loader: "js" }));
        },
      },
    ],
  });
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    process.exit(1);
  }
  console.log(`built ${outfile} (${parsed.target})`);
}

if (import.meta.main) await main();
