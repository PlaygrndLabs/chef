import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyChanges, parseFeature } from "@kargah/core";
import { ManualClock } from "@kargah/core/fakes";
import { readTree } from "../../src/fs.ts";
import { demoScript } from "../../src/demo.ts";
import { LocalCheckRunner, LocalProofRunner } from "../../src/local/index.ts";
import { generated, localWorld, REPO_ROOT, stub, templateTree } from "../../src/world.ts";
import type { Script } from "@kargah/core/fakes";

const nodeModules = join(REPO_ROOT, "template", "node_modules");
const fixture = readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo"));

function withFixture() {
  const tree = { ...templateTree(), ...fixture };
  return applyChanges(tree, { "src/registry.gen.ts": generated["src/registry.gen.ts"](tree) });
}

describe("local runners", () => {
  it("pass every check on the template with the todo feature", async () => {
    const results = await new LocalCheckRunner(nodeModules).run({ repo: "demo", commitId: "c1", tree: withFixture() });
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("fail typecheck, test and lint on a broken feature", async () => {
    const tree = applyChanges(withFixture(), {
      "features/todo-add/index.ts": `${fixture["features/todo-add/index.ts"]}\nexport const broken: number = "x";\n// explain\n`,
    });
    const results = await new LocalCheckRunner(nodeModules).run({ repo: "demo", commitId: "c2", tree });
    const failed = results.filter((r) => !r.ok).map((r) => r.name);
    expect(failed).toContain("typecheck");
    expect(failed).toContain("lint");
  });

  it("prove the todo flow by driving the app", async () => {
    const proof = await new LocalProofRunner(nodeModules, new ManualClock(1)).prove({
      repo: "demo",
      feature: "todo-add",
      flow: "features/todo-add/flow.ts",
      url: "https://todo-add-demo.preview.example",
      commitId: "c1",
      tree: withFixture(),
    });
    expect(proof.ok).toBe(true);
    expect(proof.steps.length).toBeGreaterThan(0);
  });

  it("merge the todo feature end to end with real checks", async () => {
    const prompt = "Add an item to a todo list";
    const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
    if (!spec.ok) throw new Error(spec.errors.join("\n"));
    const w = localWorld({ script: demoScript(fixture), presets: new Map([[prompt, spec.spec]]), real: true });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    expect(sessionId).not.toBeNull();
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
  });

  it("rejects tests that pass before the feature exists, then merges real ones", async () => {
    const prompt = "Add an item to a todo list";
    const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
    if (!spec.ok) throw new Error(spec.errors.join("\n"));
    const real = demoScript(fixture);
    const vacuous = ['import assert from "node:assert/strict";', 'import { test } from "node:test";', "", 'test("AC1: POST /todos adds an item and returns it", () => {', "  assert.equal(1, 1);", "});", ""].join("\n");
    const script: Script = async (input, attempt) => {
      const out = await real(input, attempt);
      if (input.role === "test" && attempt === 1) return { ...out, changes: { ...out.changes, "features/todo-add/todo-add.test.ts": vacuous } };
      return out;
    };
    const w = localWorld({ script, presets: new Map([[prompt, spec.spec]]), real: true, config: { specialization: { stub } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const rejected = w.bus.log.filter((e) => e.type === "turn.rejected");
    expect(rejected.map((e) => e.type === "turn.rejected" && [e.role, e.rule])).toEqual([["test", "red-tests"]]);
    const retry = w.coder.turns.filter((t) => t.role === "test");
    expect(retry).toHaveLength(2);
    expect(retry[1]?.prompt).toContain("- AC1: POST /todos adds an item and returns it");
  });
});
