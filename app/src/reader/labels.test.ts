import { describe, expect, test } from "bun:test";
import { downloadLabel, extBadge, splitDisplayPath } from "./labels.ts";

describe("the header's words", () => {
  test("the path splits into a folder part and a name that join back into the path exactly", () => {
    for (const path of ["docs/plan.md", "plan.md", "a/b/c/d.sql", "two/dup.md", "outside/x.md", ""]) {
      const { dir, name } = splitDisplayPath(path);
      // The e2e tells `one/dup.md` from `two/dup.md` by the header's text, so nothing may be dropped or added.
      expect(dir + name).toBe(path);
    }
    expect(splitDisplayPath("docs/plan.md")).toEqual({ dir: "docs/", name: "plan.md" });
    expect(splitDisplayPath("plan.md")).toEqual({ dir: "", name: "plan.md" });
  });

  test("the badge is the extension in capitals, and absent for a name without one", () => {
    expect(extBadge("plan.md")).toBe("MD");
    expect(extBadge("0008_funnel_stage.sql")).toBe("SQL");
    expect(extBadge("archive.tar.gz")).toBe("GZ");
    expect(extBadge("Dockerfile")).toBeNull();
    expect(extBadge(".gitignore")).toBeNull();
    expect(extBadge("trailing.")).toBeNull();
  });

  test("download names the extension, or just offers a copy", () => {
    expect(downloadLabel("plan.md")).toBe("Download as .md");
    expect(downloadLabel("REPORT.HTML")).toBe("Download as .html");
    expect(downloadLabel("Dockerfile")).toBe("Download a copy");
    expect(downloadLabel(".gitignore")).toBe("Download a copy");
  });
});
