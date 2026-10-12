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

  it("matches write scopes with exclusions", () => {
    const scope = ["features/x/**", "!features/x/**/*.test.ts"];
    expect(matchesScope("features/x/index.ts", scope)).toBe(true);
    expect(matchesScope("features/x/deep/a.test.ts", scope)).toBe(false);
    expect(matchesScope("features/y/index.ts", scope)).toBe(false);
  });
});
