import { describe, expect, it } from "vitest";
import { COMPOSE_PROMPT } from "../../src/app/compose.ts";
import type { Tree } from "../../src/git/tree.ts";
import { PROOF_NAMESPACE } from "../../src/notes/notes.ts";
import type { FeatureSpec } from "../../src/spec/schema.ts";
import type { Script } from "../../src/fakes/index.ts";
import { templateTree, world } from "../harness.ts";

const IMPORTED: Tree = {
  "package.json": `${JSON.stringify({ name: "getting-started", scripts: { test: "jest", dev: "nodemon src/index.js" }, dependencies: { express: "4.21.2" }, devDependencies: { jest: "29.7.0" } }, null, 2)}\n`,
  "yarn.lock": "# yarn lockfile v1\n",
  "src/index.js": 'const express = require("express");\nconst app = express();\napp.use(express.static(__dirname + "/static"));\napp.listen(3000);\n',
  "src/static/index.html": '<div id="root"></div>\n<script src="js/app.js"></script>\n',
  "src/static/js/app.js": "function App() {\n  return <TodoListCard />;\n}\n",
  "spec/routes/getItems.spec.js": 'test("it gets items", () => {\n  expect(1).toBe(1);\n});\n',
};

const PROMPT = "Show how many items are left under the list";

const itemsLeft: FeatureSpec = {
  id: "items-left-count",
  title: "Items left count",
  status: "building",
  entrypoint: "GET /",
  revision: 1,
  shared: [],
  env: [],
  acceptance: [{ id: "AC1", text: "a line under the list says how many items are not done" }],
  body: "A line under the list says how many items are left.",
};

const script: Script = (input) => {
  if (input.role === "test") return { changes: { "spec/static/itemsLeft.spec.js": 'test("AC1: a line under the list says how many items are not done", () => {\n  expect(itemsLeft([{ completed: false }])).toBe("1 item left");\n});\n' } };
  if (input.role === "chore") return { changes: { "compose.yaml": "services:\n  app:\n    build: .\n    ports:\n      - 3000:3000\n", Dockerfile: "FROM node:22\nWORKDIR /app\nCOPY . .\nRUN yarn install\nCMD [\"node\", \"src/index.js\"]\n" } };
  return { changes: { "src/static/js/app.js": "function App() {\n  return <><TodoListCard /><ItemsLeft /></>;\n}\n" } };
};

async function allTrees(w: ReturnType<typeof world>, repo: string, commits: readonly string[]): Promise<Tree[]> {
  return Promise.all(commits.map(async (id) => (await w.repos.readCommit(repo, id))?.tree ?? {}));
}

describe("a project with its own structure", () => {
  it("builds a feature in the repository's own files with no Chef template files, and proves the running app answers", async () => {
    const w = world({ script, presets: new Map([[PROMPT, itemsLeft]]) });
    await w.orchestrator.bootstrap(IMPORTED);
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");

    const main = (await w.orchestrator.mainTree()).tree;
    expect(main["src/static/js/app.js"]).toContain("<ItemsLeft />");
    expect(main["spec/static/itemsLeft.spec.js"]).toContain("AC1:");
    for (const tree of [main, ...(await allTrees(w, "demo", record.commits))]) {
      expect(tree["src/registry.gen.ts"]).toBeUndefined();
      expect(Object.keys(tree).filter((path) => path.startsWith("features/"))).toEqual([]);
    }

    const test = w.coder.turns.find((t) => t.role === "test");
    const backend = w.coder.turns.find((t) => t.role === "backend");
    expect(test?.writeScope).toEqual(expect.arrayContaining(["**/*.spec.*", "**/spec/**", "!spec/features/**"]));
    expect(test?.writeScope.some((p) => p.includes("flow.ts"))).toBe(false);
    expect(backend?.writeScope).toEqual(expect.arrayContaining(["**", "!**/*.test.*", "!**/spec/**", "!memory/**"]));
    expect(backend?.writeScope).not.toContain("src/registry.gen.ts");
    expect(backend?.instructions).toContain("own structure, not Chef's template");
    expect(w.planner.planned[0]?.guidance).toContain("Never create `features/`, `flow.ts`, `shared/ui.ts` or `src/registry.gen.ts`");
    expect(record.plan.items.find((i) => i.kind === "test")?.prompt ?? test?.prompt).not.toContain("flow.ts");

    const review = (w.deps.reviewer as unknown as { reviews: { ownStructure?: boolean; guidance?: string }[] }).reviews.at(-1);
    expect(review?.ownStructure).toBe(true);
    expect(review?.guidance).toContain("Never reject or redo a change for missing Chef template files");

    const gate = w.bus.log.filter((e) => e.type === "gate.result").at(-1);
    expect(gate?.type === "gate.result" && gate.checks.map((c) => c.name)).toEqual(["spec-lint", "test", "write-scope", "locked-tests", "review", "proof"]);
    const proofCommit = w.proofs.proofs.at(-1)?.commitId as string;
    expect(w.proofs.proofs.at(-1)).toMatchObject({ flow: "GET /", ok: true });
    expect(JSON.parse((await w.repos.readNote("demo", PROOF_NAMESPACE, proofCommit)) ?? "null")).toMatchObject({ ok: true, flow: "GET /" });
  });

  it("names the Dockerize chore after what it does and keeps the registry out of its commits", async () => {
    const w = world({ script });
    await w.orchestrator.bootstrap(IMPORTED);
    const chore = await w.orchestrator.submit(COMPOSE_PROMPT);
    expect(chore.decision).toMatchObject({ intent: "chore", via: "rules" });
    expect(chore.featureId).toBe("chore-dockerize");
    const record = await w.orchestrator.run(chore.sessionId as string);
    expect(record.plan.feature.title).toBe("Dockerize the project");
    expect(record.machine.state).toBe("merged");
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main["compose.yaml"]).toContain("build: .");
    expect(main["Dockerfile"]).toContain("FROM node");
    for (const tree of [main, ...(await allTrees(w, "demo", record.commits))]) expect(tree["src/registry.gen.ts"]).toBeUndefined();
  });

  it("keeps a Chef template project as it was: registry regenerated and the template's write scopes", async () => {
    const w = world({ script });
    await w.orchestrator.bootstrap(templateTree());
    const chore = await w.orchestrator.submit(COMPOSE_PROMPT);
    const record = await w.orchestrator.run(chore.sessionId as string);
    expect(record.machine.state).toBe("merged");
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main["src/registry.gen.ts"]).toContain("export const features");
    const turn = w.coder.turns.find((t) => t.role === "chore");
    expect(turn?.writeScope).toEqual(["**", "!spec/**", "!memory/**", "!features/*/**/*.test.ts", "!features/*/flow.ts"]);
    expect(turn?.instructions).toContain("This project uses Chef's template");
  });
});
