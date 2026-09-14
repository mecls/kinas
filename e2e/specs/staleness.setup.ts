import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// AC-4 / Journey C: numbers that are no longer true.
// - Claude session window: the reading's session last answered 58 minutes ago (limit 30) → stale.
// - Claude week window: its resets_at has already passed → reset.
// - Ollama: the endpoint always answers 429 with Retry-After: 900, and counts requests.

const SESSION = "33333333-3333-3333-3333-333333333333";
let server: ReturnType<typeof Bun.serve> | undefined;
let requests = 0;

export function setup(dataDir: string): Record<string, string> {
  const now = Date.now();
  const claude = join(dataDir, "claude");
  mkdirSync(join(claude, "-Users-e2e"), { recursive: true });
  writeFileSync(
    join(claude, "-Users-e2e", `${SESSION}.jsonl`),
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(now - 58 * 60_000).toISOString(),
      sessionId: SESSION,
      message: { id: "msg_idle", model: "claude-opus-5", usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } },
    }) + "\n",
  );

  mkdirSync(join(dataDir, "inbox"), { recursive: true });
  writeFileSync(
    join(dataDir, "inbox", "claude-rate-limits.json"),
    JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 50, resets_at: Math.floor(now / 1000) + 7200 },
        seven_day: { used_percentage: 90, resets_at: Math.floor(now / 1000) - 60 },
      },
      session_id: SESSION,
      captured_at: now,
    }),
  );

  requests = 0;
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/__count") return Response.json({ requests });
      if (path !== "/api/usage") return new Response("not found", { status: 404 });
      requests += 1;
      return new Response("slow down", { status: 429, headers: { "retry-after": "900" } });
    },
  });

  return {
    KINAS_CLAUDE_PROJECTS_DIR: claude,
    KINAS_OLLAMA_BASE_URL: `http://127.0.0.1:${server.port}`,
    KINAS_E2E_OLLAMA_KEY: "ollama-FAKE-e2e-key",
    KINAS_E2E_STUB_URL: `http://127.0.0.1:${server.port}`,
  };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
