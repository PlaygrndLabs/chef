import { describe, expect, it } from "vitest";
import { FakeCheckRunner } from "../../src/fakes/fake-checks.ts";
import type { CheckResult } from "../../src/ports/check-runner.ts";
import type { Tree } from "../../src/git/tree.ts";
import { fixture, generated, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { bootstrapTree, presets, promptFor, script } from "../scenarios/shared-menu.ts";

const HOME_TEST = "features/home/home.test.ts";

function withHome(tree: Tree): Tree {
  return { ...tree, "features/home/index.ts": 'import type { Feature } from "../../shared/http.ts";\n\nexport const feature: Feature = { id: "home", title: "Home", routes: [] };\n', [HOME_TEST]: 'import { test } from "node:test";\n\ntest("home", () => {});\n' };
}

function recorded() {
  const inner = new FakeCheckRunner(undefined, generated);
  const runs: { repo: string; commitId: string; tree: Tree; features?: readonly string[] }[] = [];
  const checks = {
    async run(input: { repo: string; commitId: string; tree: Tree; features?: readonly string[] }): Promise<CheckResult[]> {
      runs.push(input);
      return inner.run(input);
    },
  };
  const forkRuns = () => runs.filter((r) => r.repo !== "demo" && !/\+(red|cross)$/.test(r.commitId));
  const mainRuns = () => runs.filter((r) => r.repo === "demo");
  return { checks, forkRuns, mainRuns };
}

describe("tests before a merge", () => {
  it("runs only the changed feature's tests before the merge and every test on main after it", async () => {
    const prompt = "Add an item to a todo list";
    const { checks, forkRuns, mainRuns } = recorded();
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), deps: { checks } });
    await w.orchestrator.bootstrap(withHome(templateTree()));
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(forkRuns().length).toBeGreaterThan(0);
    for (const run of forkRuns()) expect(run.features).toEqual(["todo-add"]);
    const merged = mainRuns().filter((r) => r.tree["features/todo-add/index.ts"] !== undefined);
    expect(merged.length).toBeGreaterThan(0);
    for (const run of merged) expect(run.features).toBeUndefined();
  });

  it("runs every test before the merge when the session changes shared code", async () => {
    const { checks, forkRuns } = recorded();
    const w = world({ script, presets: presets(), deps: { checks } });
    await w.orchestrator.bootstrap(withHome(bootstrapTree(templateTree())));
    const { sessionId } = await w.orchestrator.submit(promptFor("notes"));
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const gated = forkRuns().filter((r) => r.tree["features/notes/index.ts"] !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    for (const run of gated) expect(run.features).toBeUndefined();
  });
});
