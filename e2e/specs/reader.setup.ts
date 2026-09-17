import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The reader's projects root (tasks/prd-kinas-open.md): fixtures/reader copied into the run's data folder, a file outside
// it, and a symlink out of it. External links are logged, not opened, so no browser appears on Miguel's screen.
//
// It also starts the preview probe's listener (reader PRD R12-R14, R18). `hostile.html` aims every URL it knows at
// this server; the probe asserts the log below is empty. A real socket is the point: "no requests" inferred from a
// missing <script> element is the assertion a breached reader would still pass.

interface Hit {
  method: string;
  path: string;
}

let server: ReturnType<typeof Bun.serve> | undefined;
let hits: Hit[] = [];

export function setup(dataDir: string): Record<string, string> {
  const root = join(dataDir, "root");
  cpSync(join(import.meta.dir, "../../fixtures/reader"), root, { recursive: true });
  mkdirSync(join(dataDir, "outside"), { recursive: true });
  writeFileSync(join(dataDir, "outside", "x.md"), "# Outside the root\n\nThis file is outside the projects root.\n");
  symlinkSync(join(dataDir, "outside", "x.md"), join(root, "link-out.md"));

  hits = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      // Reading the log must not appear in the log.
      if (path === "/__log") return Response.json({ requests: hits.length, hits });
      hits.push({ method: req.method, path });
      return new Response("should never be reached", { status: 200 });
    },
  });
  const probe = `http://127.0.0.1:${server.port}`;

  // Rewritten after the copy, so the fixture in git stays a placeholder rather than a machine-specific URL.
  const hostile = join(root, "hostile.html");
  writeFileSync(hostile, readFileSync(hostile, "utf8").replaceAll("__PROBE_URL__", probe).replaceAll("__PROBE_WS__", `ws://127.0.0.1:${server.port}`));

  return { KINAS_ROOT: root, KINAS_E2E_NO_OPEN: "1", KINAS_E2E_PROBE_URL: probe };
}

export function teardown(): void {
  server?.stop(true);
  server = undefined;
}
