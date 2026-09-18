import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fixtures for the Usage page (AC-2), all relative to now so the 30-day window is deterministic:
// - transcripts for today and three days ago (Claude Code) and today (Pi)
// - a status-line hand-off whose session answered a minute ago, so the Claude reading is fresh
// - a stub Ollama /api/usage serving the legacy fixture to the fake key only

const FAKE_KEY = "ollama-FAKE-e2e-key";
const CONVEX_KEY = "convex-FAKE-e2e-deploy-key";
const HOSTINGER_TOKEN = "hostinger-FAKE-e2e-token";
const SESSION = "22222222-2222-2222-2222-222222222222";
const DAY = 86_400_000;

let server: ReturnType<typeof Bun.serve> | undefined;
/** Convex requests served, so the spec can assert exactly one per poll window (convex R§5, R11's 60 s floor). */
let convexRequests = 0;
/** Hostinger requests served, so the spec can assert **zero** while no VPS is selected (hostinger R4). */
let hostingerRequests = 0;

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
  const convexBody = readFileSync(join(import.meta.dir, "../../fixtures/convex-usage.synthetic.json"), "utf8");
  const vpsBody = readFileSync(join(import.meta.dir, "../../fixtures/hostinger-vms.synthetic.json"), "utf8");
  const vpsMetricsBody = readFileSync(join(import.meta.dir, "../../fixtures/hostinger-metrics.synthetic.json"), "utf8");
  convexRequests = 0;
  hostingerRequests = 0;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      // Reading the count must not change it.
      if (path === "/__convex_count") return Response.json({ requests: convexRequests });
      if (path === "/api/v1/get_current_usage") {
        convexRequests += 1;
        // `Convex`, not `Bearer`. The stub checks the scheme on purpose: R1 calls this the single most likely
        // thing to get wrong, and a stub that accepted either would pass a reader sending the wrong one.
        if (req.headers.get("authorization") !== `Convex ${CONVEX_KEY}`) return new Response("", { status: 401 });
        return new Response(convexBody, { headers: { "content-type": "application/json" } });
      }
      if (path === "/__hostinger_count") return Response.json({ requests: hostingerRequests });
      if (path.startsWith("/api/vps/v1/virtual-machines")) {
        hostingerRequests += 1;
        // Bearer here, unlike Convex's scheme. Checked, so a reader sending the wrong one fails loudly.
        if (req.headers.get("authorization") !== `Bearer ${HOSTINGER_TOKEN}`) return new Response("", { status: 401 });
        if (path.endsWith("/metrics")) {
          // Both window parameters are required by the real API (R5), so the stub refuses without them —
          // otherwise a reader that forgot to send them would pass here and 422 against Hostinger.
          const q = new URL(req.url).searchParams;
          if (!q.get("date_from") || !q.get("date_to")) return new Response("", { status: 422 });
          return new Response(vpsMetricsBody, { headers: { "content-type": "application/json" } });
        }
        return new Response(vpsBody, { headers: { "content-type": "application/json" } });
      }
      if (path !== "/api/usage") return new Response("not found", { status: 404 });
      if (req.headers.get("authorization") !== `Bearer ${FAKE_KEY}`) return new Response("", { status: 401 });
      return new Response(body, { headers: { "content-type": "application/json" } });
    },
  });

  const base = `http://127.0.0.1:${server.port}`;
  return {
    KINAS_CLAUDE_PROJECTS_DIR: claude,
    KINAS_PI_SESSIONS_DIR: pi,
    KINAS_OLLAMA_BASE_URL: base,
    KINAS_E2E_OLLAMA_KEY: FAKE_KEY,
    // One server, two providers: fewer ports and one teardown.
    KINAS_CONVEX_BASE_URL: base,
    KINAS_E2E_CONVEX_KEY: CONVEX_KEY,
    // The spec needs both to assert the request count and to save a deployment URL — the reader refuses to
    // request at all until a non-empty URL is stored, whatever the base-URL override says.
    KINAS_E2E_CONVEX_STUB: base,
    // Hostinger on the same server, for the same reason.
    KINAS_HOSTINGER_BASE_URL: base,
    KINAS_E2E_HOSTINGER_KEY: HOSTINGER_TOKEN,
    KINAS_E2E_HOSTINGER_STUB: base,
  };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
