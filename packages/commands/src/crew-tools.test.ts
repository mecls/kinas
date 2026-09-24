import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/crew-tools.json";
import { atLeast, FIRSTMATE_PIN, FIRSTMATE_REPO, HOME_DIR, PREREQS, TOOLS, versionOf, WORKSPACE_LABEL } from "./crew-tools.ts";

describe("the crew's tools (build spec §9)", () => {
  test("equal the shared fixture, which the app's pin.rs is held to as well", () => {
    expect({ repo: FIRSTMATE_REPO, pin: FIRSTMATE_PIN, home_dir: HOME_DIR, workspace_label: WORKSPACE_LABEL }).toEqual(fixture.firstmate);
    expect(TOOLS).toEqual(fixture.tools as unknown as typeof TOOLS);
    expect(PREREQS).toEqual(fixture.prereqs);
  });

  test("a version is the first major.minor.patch in the line", () => {
    expect(versionOf("no-mistakes version v1.79.0 (fc540ac) 2026-09-19T09:34:44Z")).toBe("1.79.0");
    expect(versionOf("v2.3.0")).toBe("2.3.0");
    expect(versionOf("0.1.35\n")).toBe("0.1.35");
    expect(versionOf("unknown")).toBeNull();
  });

  test("floors compare numerically; 0 is any version; unparseable is below", () => {
    expect(atLeast("0.1.35", "0.1.29")).toBe(true);
    expect(atLeast("0.1.29", "0.1.29")).toBe(true);
    expect(atLeast("0.1.28", "0.1.29")).toBe(false);
    expect(atLeast("0.10.0", "0.9.9")).toBe(true);
    expect(atLeast("1.0.0", "0.99.99")).toBe(true);
    expect(atLeast("anything", "0")).toBe(true);
    expect(atLeast("dev", "0.1.0")).toBe(false);
  });
});
