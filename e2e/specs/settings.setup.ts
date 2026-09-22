import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Journey B / AC-3: nothing connected. No hand-off file, no key in the (in-memory) Keychain, and a stub Ollama
// that counts every request and answers `/__count` so the spec can assert none happened before a key existed.
//
// R1b types into the Projects folder field, which Settings disables while KINAS_ROOT is set (the environment wins
// over it, paths.rs). So this spec clears the variable run.ts sets and gives the same empty root through a config
// file of its own: the field is live, and the sidebar still lists nothing of Miguel's.

let server: ReturnType<typeof Bun.serve> | undefined;
let requests = 0;

export function setup(dataDir: string): Record<string, string> {
  requests = 0;
  // Its real path: Settings stores a canonical folder, and R1b puts the one it read back (/var is /private/var).
  const root = join(dataDir, "root");
  mkdirSync(root, { recursive: true });
  const config = join(dataDir, "config.json");
  writeFileSync(config, `${JSON.stringify({ root: realpathSync(root) })}\n`);
  const body = readFileSync(join(import.meta.dir, "../../fixtures/ollama-usage-legacy.synthetic.json"), "utf8");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/__count") return Response.json({ requests });
      if (path !== "/api/usage") return new Response("not found", { status: 404 });
      requests += 1;
      if (req.headers.get("authorization") !== "Bearer ollama-FAKE-typed-key") return new Response("", { status: 401 });
      return new Response(body, { headers: { "content-type": "application/json" } });
    },
  });
  return {
    KINAS_OLLAMA_BASE_URL: `http://127.0.0.1:${server.port}`,
    KINAS_E2E_STUB_URL: `http://127.0.0.1:${server.port}`,
    KINAS_ROOT: "",
    KINAS_CONFIG: config,
  };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
