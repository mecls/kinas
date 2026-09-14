import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fixtures for the Usage page (AC-2), all relative to now so the 30-day window is deterministic:
// - transcripts for today and three days ago (Claude Code) and today (Pi)
// - a status-line hand-off whose session answered a minute ago, so the Claude reading is fresh
// - a stub Ollama /api/usage serving the legacy fixture to the fake key only

const FAKE_KEY = "ollama-FAKE-e2e-key";
const SESSION = "22222222-2222-2222-2222-222222222222";
const DAY = 86_400_000;

let server: ReturnType<typeof Bun.serve> | undefined;

const claudeLine = (id: string, at: number, model: string, input: number, output: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: new Date(at).toISOString(),
    sessionId: SESSION,
    message: { id, model, usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } },
  });

export function setup(dataDir: string): Record<string, string> {
  const now = Date.now();
  const claude = join(dataDir, "claude");
  const pi = join(dataDir, "pi");

  mkdirSync(join(claude, "-Users-e2e"), { recursive: true });
  writeFileSync(
    join(claude, "-Users-e2e", `${SESSION}.jsonl`),
    [claudeLine("msg_old", now - 3 * DAY, "claude-opus-5", 1200, 800), claudeLine("msg_live", now - 60_000, "claude-opus-5", 900, 300)].join("\n") + "\n",
  );

  mkdirSync(join(pi, "--Users-e2e--"), { recursive: true });
  writeFileSync(
    join(pi, "--Users-e2e--", "2026-01-01T00-00-00-000Z_e2e.jsonl"),
    JSON.stringify({
      type: "message",
      id: "pi00001",
      timestamp: new Date(now - 120_000).toISOString(),
      message: { role: "assistant", provider: "ollama", model: "glm-5.3:cloud", usage: { input: 400, output: 100, cacheRead: 0, cacheWrite: 0 } },
    }) + "\n",
  );

  mkdirSync(join(dataDir, "inbox"), { recursive: true });
  writeFileSync(
    join(dataDir, "inbox", "claude-rate-limits.json"),
    JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: Math.floor(now / 1000) + 7200 },
        seven_day: { used_percentage: 23.5, resets_at: Math.floor(now / 1000) + 3 * 86400 },
      },
      session_id: SESSION,
      captured_at: now,
    }),
  );

  const body = readFileSync(join(import.meta.dir, "../../fixtures/ollama-usage-legacy.synthetic.json"), "utf8");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname !== "/api/usage") return new Response("not found", { status: 404 });
      if (req.headers.get("authorization") !== `Bearer ${FAKE_KEY}`) return new Response("", { status: 401 });
      return new Response(body, { headers: { "content-type": "application/json" } });
    },
  });

  return {
    KINAS_CLAUDE_PROJECTS_DIR: claude,
    KINAS_PI_SESSIONS_DIR: pi,
    KINAS_OLLAMA_BASE_URL: `http://127.0.0.1:${server.port}`,
    KINAS_E2E_OLLAMA_KEY: FAKE_KEY,
  };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
