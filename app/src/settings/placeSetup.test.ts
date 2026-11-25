import { describe, expect, test } from "bun:test";
import { allOk, byHand, CHECK_LABELS, installLabel } from "./placeSetup.ts";

describe("setup's words in Settings (slice 4.3)", () => {
  test("every row the Mac lets through has a name", () => {
    const ids = ["system", "herdr", "herdr-server", "firstmate", "relay-rule", "permission-mode", "tools", "node", "companion", "linger", "claude", "gh", "api-key", "projects"];
    expect(Object.keys(CHECK_LABELS)).toEqual(ids);
  });

  test("Install says what it does; adopting a running server says so", () => {
    expect(installLabel({ install: "herdr", adopt: false })).toBe("Install Herdr");
    expect(installLabel({ install: "herdr-service", adopt: false })).toBe("Start under systemd");
    expect(installLabel({ install: "herdr-service", adopt: true })).toBe("Run Herdr under systemd");
    expect(installLabel({ install: null, adopt: false })).toBeNull();
  });

  test("the by-hand lines name the target; all green is done", () => {
    expect(byHand(["scp dist/kinas-linux-x64 <target>:.local/bin/kinas"], "captain@vps")).toEqual(["scp dist/kinas-linux-x64 captain@vps:.local/bin/kinas"]);
    const row = (state: "ok" | "warn") => ({ id: "x", state, detail: "", install: null, adopt: false, run: null });
    expect(allOk([row("ok"), row("ok")])).toBe(true);
    expect(allOk([row("ok"), row("warn")])).toBe(false);
    expect(allOk([])).toBe(false);
  });
});
