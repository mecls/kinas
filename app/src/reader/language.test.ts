import { describe, expect, test } from "bun:test";
import { languageFor, languageForFence } from "./language.ts";

// Extension to highlight.js language id (R11). The table exists because the two vocabularies disagree, so these
// cases are the disagreements, not a sample of the agreements.

describe("the aliases that matter", () => {
  test("the library's name wins over the extension", () => {
    expect(languageFor("ts")).toBe("typescript");
    expect(languageFor("tsx")).toBe("typescript");
    expect(languageFor("mjs")).toBe("javascript");
    expect(languageFor("yml")).toBe("yaml");
    expect(languageFor("rs")).toBe("rust");
    expect(languageFor("h")).toBe("cpp");
    expect(languageFor("zsh")).toBe("bash");
    // highlight.js has no "html": markup is xml.
    expect(languageFor("html")).toBe("xml");
    expect(languageFor("htm")).toBe("xml");
  });

  test("an extension that is already the id passes through", () => {
    expect(languageFor("sql")).toBe("sql");
    expect(languageFor("json")).toBe("json");
    expect(languageFor("toml")).toBe("toml");
  });

  test("a file with no extension is matched by its whole name", () => {
    // Rust sends the lowercased file name when there is no extension, which is what makes these work.
    expect(languageFor("dockerfile")).toBe("dockerfile");
    expect(languageFor("makefile")).toBe("makefile");
    expect(languageFor("gemfile")).toBe("ruby");
  });

  test("case does not matter, because a real path may be shouting", () => {
    expect(languageFor("SQL")).toBe("sql");
    expect(languageFor("Dockerfile")).toBe("dockerfile");
  });
});

describe("an unknown language renders plain", () => {
  test("null, never a guess", () => {
    // Deliberately not highlight.js's auto-detection: slow, pulls many grammars, and confidently wrong often
    // enough to be worse than monospace. These are real extensions the owner has in his tree.
    expect(languageFor("prisma")).toBeNull();
    expect(languageFor("tf")).toBeNull();
    expect(languageFor("")).toBeNull();
    expect(languageFor("exe")).toBeNull();
  });
});

describe("a markdown fence's info string", () => {
  test("the first word decides, and trailing words are ignored", () => {
    expect(languageForFence("ts")).toBe("typescript");
    expect(languageForFence("  sql  ")).toBe("sql");
    expect(languageForFence("ts twoslash")).toBe("typescript");
  });

  test("no info, or an unknown one, renders plain", () => {
    expect(languageForFence("")).toBeNull();
    expect(languageForFence("   ")).toBeNull();
    expect(languageForFence("prisma")).toBeNull();
  });
});

describe("the ids task 5.3 must register", () => {
  test("every distinct id in the table, so highlight.ts has a checkable list", () => {
    // A mapped id with no loader is worse than no mapping: the code would ask for a chunk that does not exist and
    // render nothing. This list is the contract between this table and highlight.ts's import thunks.
    const ids = new Set(
      [
        "ts",
        "tsx",
        "mts",
        "cts",
        "js",
        "jsx",
        "mjs",
        "cjs",
        "sh",
        "zsh",
        "bash",
        "fish",
        "yml",
        "rs",
        "py",
        "rb",
        "kt",
        "h",
        "hpp",
        "cc",
        "md",
        "mdx",
        "htm",
        "html",
        "svg",
        "sql",
        "json",
        "css",
        "scss",
        "less",
        "xml",
        "toml",
        "ini",
        "diff",
        "patch",
        "go",
        "java",
        "swift",
        "php",
        "lua",
        "c",
        "cpp",
        "cs",
        "graphql",
        "dockerfile",
        "makefile",
        "gemfile",
        "rakefile",
        "procfile",
      ]
        .map(languageFor)
        .filter((id): id is string => id !== null),
    );
    // Taken from what the table actually produces, not retyped: writing it by hand got `yaml` missed and
    // `csharp`/`css` swapped, since "csharp" sorts first ('h' before 's').
    expect([...ids].sort()).toEqual([
      "bash",
      "c",
      "cpp",
      "csharp",
      "css",
      "diff",
      "dockerfile",
      "go",
      "graphql",
      "ini",
      "java",
      "javascript",
      "json",
      "kotlin",
      "less",
      "lua",
      "makefile",
      "markdown",
      "php",
      "python",
      "ruby",
      "rust",
      "scss",
      "sql",
      "swift",
      "toml",
      "typescript",
      "xml",
      "yaml",
    ]);
  });
});
