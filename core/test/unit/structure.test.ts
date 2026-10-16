import { describe, expect, it } from "vitest";
import { COMPOSE_TASK } from "../../src/app/compose.ts";
import { choreId, chorePlan, choreTitle } from "../../src/ports/planner.ts";
import { scopeFor, type AgentProfile } from "../../src/profiles/profile.ts";
import { entryPath, ownScope, repoChecks, structureGuidance, usesChefTemplate } from "../../src/structure/structure.ts";
import { matchesScope } from "../../src/util/glob.ts";
import { profiles, templateTree, todoSpec } from "../harness.ts";

const imported = {
  "package.json": JSON.stringify({ name: "getting-started", scripts: { test: "jest", prettify: "prettier -l --write \"**/*.js\"" } }),
  "yarn.lock": "# yarn lockfile v1\n",
  "src/index.js": "require('express')\n",
  "spec/routes/getItems.spec.js": "test('x', () => {})\n",
};

describe("project structure", () => {
  it("tells a Chef template tree from a repository with its own structure", () => {
    expect(usesChefTemplate(templateTree())).toBe(true);
    expect(usesChefTemplate(imported)).toBe(false);
    expect(usesChefTemplate({ ...imported, "src/registry.gen.ts": "" })).toBe(false);
    expect(structureGuidance(templateTree())).toContain("uses Chef's template");
    expect(structureGuidance(imported)).toContain("own structure, not Chef's template");
    for (const tree of [templateTree(), imported]) expect(structureGuidance(tree)).toContain("`condition: service_healthy`");
  });

  it("reads the template's write scopes for the repository's real files", () => {
    const roles = profiles();
    const backend = scopeFor(roles["backend"] as AgentProfile, todoSpec, false);
    expect(matchesScope("src/static/js/app.js", backend)).toBe(true);
    expect(matchesScope("spec/routes/getItems.spec.js", backend)).toBe(false);
    expect(matchesScope("src/app.test.ts", backend)).toBe(false);
    expect(matchesScope("spec/features/todo-add.md", backend)).toBe(false);
    expect(matchesScope(".chef/features/todo/SPECS.md", backend)).toBe(false);
    const test = scopeFor(roles["test"] as AgentProfile, todoSpec, false);
    expect(matchesScope("spec/routes/getItems.spec.js", test)).toBe(true);
    expect(matchesScope("src/__tests__/app.js", test)).toBe(true);
    expect(matchesScope("src/static/js/app.js", test)).toBe(false);
    expect(matchesScope("spec/features/todo-add.md", test)).toBe(false);
    const chore = scopeFor(roles["chore"] as AgentProfile, todoSpec, false);
    expect(matchesScope("spec/routes/getItems.spec.js", chore)).toBe(true);
    expect(matchesScope("Dockerfile", chore)).toBe(true);
    expect(matchesScope("spec/features/todo-add.md", chore)).toBe(false);
    expect(ownScope(["features/{feature}/**", "!features/{feature}/flow.ts", "src/registry.gen.ts"]).some((p) => p.includes("features/") && !p.startsWith("!spec/"))).toBe(false);
    expect(scopeFor(roles["backend"] as AgentProfile, todoSpec)).toEqual(["features/todo-add/**", "!features/todo-add/**/*.test.ts", "!features/todo-add/flow.ts", "src/registry.gen.ts"]);
  });

  it("runs a repository's own install and scripts, and says when it has none", () => {
    const own = repoChecks(imported);
    expect(own.install?.argv).toEqual(["npx", "--yes", "yarn@1", "install", "--frozen-lockfile"]);
    expect(own.commands.map((c) => [c.name, c.argv.join(" ")])).toEqual([["test", "npm run --silent test"]]);
    expect(own.notes).toEqual([]);
    expect(repoChecks({ ...imported, "yarn.lock": "# changed\n" }).install?.key).not.toBe(own.install?.key);

    const npm = repoChecks({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', lint: "eslint .", typecheck: "tsc" } }), "package-lock.json": "{}" });
    expect(npm.install?.argv).toEqual(["npm", "ci", "--no-audit", "--no-fund"]);
    expect(npm.commands.map((c) => c.name)).toEqual(["typecheck", "lint"]);
    expect(npm.notes.map((n) => [n.name, n.ok])).toEqual([["test", true]]);

    expect(repoChecks({ "package.json": JSON.stringify({ packageManager: "pnpm@10.28.0+sha512.abc" }) }).install?.argv).toEqual(["npx", "--yes", "pnpm@10.28.0", "install", "--frozen-lockfile"]);
    expect(repoChecks({ "package.json": JSON.stringify({ packageManager: "yarn@4.5.0" }) }).install?.argv).toEqual(["corepack", "yarn@4.5.0", "install", "--immutable"]);

    const python = repoChecks({ "main.py": "print(1)\n" });
    expect(python.install).toBeNull();
    expect(python.commands).toEqual([]);
    expect(python.notes[0]).toMatchObject({ name: "checks", ok: true });
    expect(python.notes[0]?.log).toContain("no package.json");
  });

  it("proves an own-structure app at the feature's page or at /", () => {
    expect(entryPath("GET /notes")).toBe("/notes");
    expect(entryPath("/items")).toBe("/items");
    expect(entryPath("POST /todos")).toBe("/");
    expect(entryPath("GET /items/:id")).toBe("/");
    expect(entryPath("src/index.ts")).toBe("/");
  });

  it("gives chores a short readable id and title", () => {
    expect(choreTitle(COMPOSE_TASK)).toBe("Dockerize the project");
    expect(choreId(COMPOSE_TASK, new Set())).toBe("chore-dockerize");
    expect(choreId(COMPOSE_TASK, new Set(["chore-dockerize"]))).toBe("chore-dockerize-2");
    expect(chorePlan("chore-dockerize", COMPOSE_TASK, "chore").feature).toMatchObject({ title: "Dockerize the project", body: COMPOSE_TASK });
    expect(choreId("Explain how to run the tests in the README", new Set())).toBe("chore-explain-how-run-tests");
    const long = "Add a compose.yaml at the root of the code that runs this project's whole stack with Docker and every service";
    expect(choreTitle(long)).toBe("Add a compose.yaml at the root of the code that runs this");
    expect(choreId(long, new Set())).toBe("chore-add-compose-yaml-root");
  });
});
