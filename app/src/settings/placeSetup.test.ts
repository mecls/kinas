import { describe, expect, test } from "bun:test";
import { allOk, byHand, CHECK_LABELS, installLabel, secondClick } from "./placeSetup.ts";

describe("setup's words in Settings (slice 4.3)", () => {
  test("every row the Mac lets through has a name", () => {
    const ids = [
      "system",
      "herdr",
      "herdr-server",
      "firstmate",
      "relay-rule",
      "relay-instruction",
      "first-mate-launch",
      "worker-sandbox",
      "github-app",
      "permission-mode",
      "tools",
      "node",
      "companion",
      "linger",
      "claude",
      "gh",
      "api-key",
      "projects",
    ];
    expect(Object.keys(CHECK_LABELS)).toEqual(ids);
  });

  test("Install says what it does; adopting a running server says so", () => {
    expect(installLabel({ install: "herdr", adopt: false, restart: false })).toBe("Install Herdr");
    expect(installLabel({ install: "herdr-service", adopt: false, restart: false })).toBe("Start under systemd");
    expect(installLabel({ install: "herdr-service", adopt: true, restart: false })).toBe("Run Herdr under systemd");
    expect(installLabel({ install: null, adopt: false, restart: false })).toBeNull();
    expect(installLabel({ install: "relay-instruction", adopt: false, restart: false })).toBe("Install");
    expect(installLabel({ install: "worker-sandbox", adopt: false, restart: false })).toBe("Sandbox workers");
    expect(installLabel({ install: "worker-sandbox", adopt: false, restart: true })).toBe("Restart Herdr");
  });

  test("an install that stops something running takes a second click, with its warning (ADR 0027)", () => {
    expect(secondClick({ adopt: false, restart: false })).toBeNull();
    expect(secondClick({ adopt: true, restart: false })).toBe("This stops Herdr's running server there and every pane in it. Click again to go ahead.");
    expect(secondClick({ adopt: false, restart: true })).toBe("closes every pane on the Linux machine: close what's open first");
  });

  test("the by-hand lines name the target; all green is done", () => {
    expect(byHand(["scp dist/kinas-linux-x64 <target>:.local/bin/kinas"], "captain@vps")).toEqual(["scp dist/kinas-linux-x64 captain@vps:.local/bin/kinas"]);
    const row = (state: "ok" | "warn") => ({ id: "x", state, detail: "", install: null, adopt: false, restart: false, run: null });
    expect(allOk([row("ok"), row("ok")])).toBe(true);
    expect(allOk([row("ok"), row("warn")])).toBe(false);
    expect(allOk([])).toBe(false);
  });
});
