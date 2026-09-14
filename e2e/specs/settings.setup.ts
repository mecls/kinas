import { readFileSync } from "node:fs";
import { join } from "node:path";

// Journey B / AC-3: nothing connected. No hand-off file, no key in the (in-memory) Keychain, and a stub Ollama
// that counts every request and answers `/__count` so the spec can assert none happened before a key existed.

let server: ReturnType<typeof Bun.serve> | undefined;
let requests = 0;

export function setup(): Record<string, string> {
  requests = 0;
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
  return { KINAS_OLLAMA_BASE_URL: `http://127.0.0.1:${server.port}`, KINAS_E2E_STUB_URL: `http://127.0.0.1:${server.port}` };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
