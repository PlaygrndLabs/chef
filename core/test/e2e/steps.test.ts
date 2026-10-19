import { describe, expect, it } from "vitest";
import { FakeCheckRunner } from "../../src/fakes/fake-checks.ts";
import { PROOF_NAMESPACE } from "../../src/notes/notes.ts";
import { readSpec } from "../../src/spec/lint.ts";
import type { Tree } from "../../src/git/tree.ts";
import type { Steps } from "../../src/orchestrator/orchestrator.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Todo add: a person adds an item to a todo list and sees it";

function indexOracle(tree: Tree) {
  const missing = [...new Set(Object.keys(tree).flatMap((p) => /^features\/([^/]+)\//.exec(p)?.[1] ?? []))].filter((f) => tree[`features/${f}/index.ts`] === undefined);
  return { ok: missing.length === 0, log: missing.map((f) => `features/${f} has no index.ts`).join("\n") || "features ok" };
}

function withSteps(steps: Steps) {
  const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), config: { steps: async () => steps }, deps: { checks: new FakeCheckRunner(indexOracle) } });
  let planned = 0;
  const plan = w.planner.plan.bind(w.planner);
  w.planner.plan = (input) => {
    planned++;
    return plan(input);
  };
  return { w, planned: () => planned };
}

describe("build steps", () => {
  it("builds straight from the request with one builder when planning, tests and review are off", async () => {
    const { w, planned } = withSteps({ plan: false, tests: false, review: false });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId, featureId } = await w.orchestrator.submit(PROMPT);
    expect(featureId).toBe("todo-add");
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(planned()).toBe(0);
    expect(w.coder.turns.map((t) => t.role)).toEqual(["backend"]);
    expect(w.coder.turns[0]?.prompt).toContain("Todo add");
    expect(w.bus.log.some((e) => e.type === "agent.started" && e.role === "reviewer")).toBe(false);
    expect(w.bus.log.filter((e) => e.type === "session.state").map((e) => e.type === "session.state" && e.to)).not.toContain("testing");
    const gate = w.bus.log.find((e) => e.type === "gate.result");
    const checks = gate?.type === "gate.result" ? gate.checks : [];
    expect(checks.find((c) => c.name === "review")?.log).toBe("review is off for this project");
    expect(checks.find((c) => c.name === "proof")?.log).toContain("Chef checked that the running app answers at /todo-add");

    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    const spec = readSpec(main?.tree ?? {}).find((f) => f.id === "todo-add");
    expect(spec?.status).toBe("merged");
    expect(spec?.entrypoint).toBe("GET /todo-add");
    expect(spec?.acceptance.map((c) => c.text)).toEqual([PROMPT]);
    expect(main?.tree["features/todo-add/index.ts"]).toBeDefined();
    expect(main?.tree["features/todo-add/todo-add.test.ts"]).toBeUndefined();
    const proofHead = record.verdict?.commitId as string;
    expect(JSON.parse((await w.repos.readNote("demo", PROOF_NAMESPACE, proofHead)) ?? "null")?.path).toBe("/todo-add");
  });

  it("writes tests first only when tests are on, and reviews only when review is on", async () => {
    const { w, planned } = withSteps({ plan: true, tests: true, review: false });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(planned()).toBe(1);
    expect(w.coder.turns[0]?.role).toBe("test");
    expect(w.bus.log.some((e) => e.type === "agent.started" && e.role === "reviewer")).toBe(false);
  });

  it("drops the planner's test step when tests are off", async () => {
    const { w, planned } = withSteps({ plan: true, tests: false, review: true });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(planned()).toBe(1);
    expect(w.coder.turns.map((t) => t.role)).not.toContain("test");
    expect(w.bus.log.some((e) => e.type === "agent.started" && e.role === "reviewer")).toBe(true);
  });
});
