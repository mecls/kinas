import { join } from "node:path";

// Run through e2e/run.ts, which builds the debug app once and gives every spec its own data folder.
const root = join(import.meta.dirname, "..");
const app = join(root, "app/src-tauri/target/debug/kinas-app");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [join(root, "e2e/specs/**/*.e2e.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: app },
    } as WebdriverIO.Capabilities,
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: app,
        // macOS has no WKWebView driver; the app embeds one in debug builds (build spec invariant 19).
        driverProvider: "embedded",
        startTimeout: 60000,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120000 },
  logLevel: "warn",
  waitforTimeout: 15000,
};
