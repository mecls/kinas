// Compiles the kinas CLI into one arm64 binary for the app bundle (Tauri externalBin).
//
//   bun scripts/build-cli.ts <outfile>
//
// Ink imports react-devtools-core only when React DevTools is wanted (DEV=true and the package installed). It is
// not a dependency, so the compiler is given an empty module for it instead of failing to resolve it.

import { resolve } from "node:path";

const outfile = resolve(process.cwd(), process.argv[2] ?? "app/src-tauri/binaries/kinas-cli-aarch64-apple-darwin");

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "../cli/src/main.ts")],
  compile: { target: "bun-darwin-arm64", outfile },
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
console.log(`built ${outfile}`);
