import { describe, expect, test } from "bun:test";
import { countLabel } from "./ChangeMark.tsx";

describe("a roll-up's count (DESIGN.md §4 Change mark)", () => {
  test("countLabel_caps_at_99_plus", () => {
    expect(countLabel(1)).toBe("1");
    expect(countLabel(99)).toBe("99");
    expect(countLabel(100)).toBe("99+");
    expect(countLabel(150)).toBe("99+");
  });
});
