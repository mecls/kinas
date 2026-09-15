import { describe, expect, test } from "bun:test";
import { classifyLink, joinPath } from "./links.ts";

const current = "/r/docs/plan.md";
const at = (href: string | null) => classifyLink(href, current, "/r");

describe("link kinds (R21)", () => {
  test("a fragment scrolls within the page", () => {
    expect(at("#part")).toEqual({ kind: "fragment", id: "part" });
    expect(at("#ca%C3%A7ão")).toEqual({ kind: "fragment", id: "cação" });
    expect(at("?x=1#part")).toEqual({ kind: "fragment", id: "part" });
  });

  test("http, https and mailto are external; every other scheme is ignored", () => {
    expect(at("https://a.b/c")).toEqual({ kind: "external", url: "https://a.b/c" });
    expect(at("HTTP://a.b")).toEqual({ kind: "external", url: "HTTP://a.b" });
    expect(at("mailto:x@y.z")).toEqual({ kind: "external", url: "mailto:x@y.z" });
    for (const href of ["vscode://file/x", "file:///etc/hosts", "javascript:alert(1)", "data:text/html,x", "//evil.example/x", "", null]) {
      expect(at(href)).toEqual({ kind: "ignore" });
    }
  });

  test("paths resolve against the current file's folder, or the root for a leading /", () => {
    expect(at("../other.md#part")).toEqual({ kind: "file", path: "/r/other.md", fragment: "part" });
    expect(at("/docs/x.md")).toEqual({ kind: "file", path: "/r/docs/x.md", fragment: null });
    expect(at("other%20file.md")).toEqual({ kind: "file", path: "/r/docs/other file.md", fragment: null });
    expect(at("./a.md?raw=1")).toEqual({ kind: "file", path: "/r/docs/a.md", fragment: null });
    expect(at("../src/index.ts")).toEqual({ kind: "file", path: "/r/src/index.ts", fragment: null });
  });

  test("climbing out of the root still yields a path; Rust decides whether it may open", () => {
    expect(at("../../../../etc/passwd.md")).toEqual({ kind: "file", path: "/etc/passwd.md", fragment: null });
    expect(joinPath("/", "../../x")).toBe("/x");
  });
});
