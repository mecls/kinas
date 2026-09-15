// kinas-context — a Pi extension. When an interactive Pi session starts it runs `kinas context --agent` once and puts
// the packet in front of the system prompt on every turn, so the session starts knowing which projects exist, what
// the crew is doing, what is blocked, and which conventions apply. The same text every turn keeps the prompt prefix
// stable for providers that cache it. Print, JSON and RPC runs are left alone.
//
// Install (see integrations/README.md): copy or symlink this file into ~/.pi/agent/extensions/, then /reload.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TIMEOUT_MS = 30_000;

export default function kinasContext(pi: ExtensionAPI) {
  let packet: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    packet = null;
    if (ctx.mode !== "tui") return;
    try {
      const result = await pi.exec(process.env.KINAS_BIN ?? "kinas", ["context", "--agent"], { timeout: TIMEOUT_MS });
      if (result.code === 0 && result.stdout.trim() !== "") packet = result.stdout.trim();
      else ctx.ui.notify(`kinas context: ${result.stderr.trim() || `exit ${result.code}`}`, "warning");
    } catch (e) {
      ctx.ui.notify(`kinas context: ${(e as Error).message}`, "warning");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!packet) return;
    return { systemPrompt: `${packet}\n\n${event.systemPrompt}` };
  });
}
