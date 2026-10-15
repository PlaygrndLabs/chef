import { describe, expect, it } from "vitest";
import { checkTree } from "../../src/checks/code-rules.ts";
import { matchesScope } from "../../src/util/glob.ts";

describe("code rules", () => {
  it("finds comments but not comment-like strings or regexes", () => {
    const tree = { "features/a/index.ts": 'const url = "http://x";\nconst re = /\\/\\/ not a comment/;\n// real comment\nconst b = 1; /* block */\n' };
    expect(checkTree(tree, ["no-comments"]).map((p) => p.line)).toEqual([3, 4]);
  });

  it("allows ts-expect-error and eslint directives", () => {
    expect(checkTree({ "a.ts": "// @ts-expect-error\nconst x: number = 'a';\n" }, ["no-comments"])).toEqual([]);
  });

  it("enforces vertical slices", () => {
    const problems = checkTree(
      {
        "features/a/index.ts": 'import { b } from "../b/index.ts";\nimport { s } from "../../shared/http.ts";\n',
        "shared/http.ts": 'import { a } from "../features/a/index.ts";\n',
        "src/index.ts": 'import { x } from "../features/a/internal.ts";\nimport { feature } from "../features/a/index.ts";\n',
      },
      ["import-boundaries"],
    );
    expect(problems.map((p) => `${p.path}:${p.line}`)).toEqual(["features/a/index.ts:1", "shared/http.ts:1", "src/index.ts:1"]);
  });

  it("lets a feature's tests build the whole app from the registry, but not its code", () => {
    const problems = checkTree(
      {
        "features/a/a.test.ts": 'import { features } from "../../src/registry.gen.ts";\n',
        "features/a/flow.ts": 'import { features } from "../../src/registry.gen.ts";\n',
        "features/a/backend/api.ts": 'import { features } from "../../../src/registry.gen.ts";\n',
        "features/a/b.test.ts": 'import { x } from "../../src/index.ts";\n',
      },
      ["import-boundaries"],
    );
    expect(problems.map((p) => p.path)).toEqual(["features/a/backend/api.ts", "features/a/b.test.ts"]);
  });

  it("keeps file reads out of code that runs on Cloudflare", () => {
    const problems = checkTree(
      {
        "features/notes/frontend/routes.ts": 'import { readFile } from "node:fs/promises";\n',
        "shared/look.ts": 'import fs from "fs";\n',
        "features/notes/notes.test.ts": 'import { readFileSync } from "node:fs";\n',
        "features/notes/flow.ts": 'import { readFileSync } from "node:fs";\n',
        "app/cli.ts": 'import { readFile } from "node:fs/promises";\n',
      },
      ["import-boundaries"],
    );
    expect(problems.map((p) => p.path)).toEqual(["features/notes/frontend/routes.ts", "shared/look.ts"]);
    expect(problems[0]?.message).toMatch(/no files to read at runtime; keep text such as CSS in a \.ts module/);
  });

  it("flags imports of packages the project does not install", () => {
    const tree = {
      "package.json": JSON.stringify({ devDependencies: { playwright: "1.56.1", "@types/node": "22.20.5" } }),
      "features/a/a.test.ts": 'import assert from "node:assert/strict";\nimport { chromium } from "playwright";\nimport { JSDOM } from "jsdom";\nimport type { X } from "@scope/pkg/sub";\nimport { b } from "./b.ts";\n',
    };
    expect(checkTree(tree, ["known-packages"]).map((p) => `${p.line} ${p.message}`)).toEqual([
      '3 package "jsdom" is not installed; import a node: builtin or a package listed in package.json',
      '4 package "@scope/pkg" is not installed; import a node: builtin or a package listed in package.json',
    ]);
    expect(checkTree({ "features/a/a.ts": 'import { JSDOM } from "jsdom";\n' }, ["known-packages"])).toEqual([]);
  });

  it("keeps a feature's tests from sharing one store", () => {
    const shared = [
      'import { MemoryStore } from "../../shared/storage.ts";',
      "const store = new MemoryStore();",
      'describe("books", () => {',
      "  const inner = new MemoryStore();",
      '  it("adds", () => { const own = new MemoryStore(); });',
      "});",
      "let fresh;",
      "beforeEach(() => { fresh = new MemoryStore(); });",
      "function call() { return new MemoryStore(); }",
      'test("votes", async () => { const own = new MemoryStore(); });',
    ].join("\n");
    const tree = { "features/books/books.test.ts": shared, "features/books/index.ts": shared, "app/cli.test.ts": shared };
    const problems = checkTree({ ...tree, "app/testing.ts": "" }, ["test-isolation"]);
    expect(problems.map((p) => `${p.path}:${p.line}`)).toEqual(["features/books/books.test.ts:2", "features/books/books.test.ts:4"]);
    expect(problems[0]?.message).toMatch(/testApp\(t, features\) from app\/testing\.ts/);
    expect(checkTree(tree, ["test-isolation"])).toEqual([]);
  });

  it("matches write scopes with exclusions", () => {
    const scope = ["features/x/**", "!features/x/**/*.test.ts"];
    expect(matchesScope("features/x/index.ts", scope)).toBe(true);
    expect(matchesScope("features/x/deep/a.test.ts", scope)).toBe(false);
    expect(matchesScope("features/y/index.ts", scope)).toBe(false);
  });
});
