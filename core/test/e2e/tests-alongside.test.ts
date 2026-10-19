import { describe, expect, it } from "vitest";
import { FakeCheckRunner } from "../../src/fakes/fake-checks.ts";
import type { Script } from "../../src/fakes/index.ts";
import type { Tree } from "../../src/git/tree.ts";
import { fixture, generated, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";
const BROKEN = "// broken on purpose";

function brokenOracle(tree: Tree) {
  const broken = Object.keys(tree).filter((p) => tree[p]?.includes(BROKEN));
  return { ok: broken.length === 0, log: broken.map((p) => `${p} fails its feature's tests`).join("\n") || "tests pass" };
}

function alongside(breakFirst = false) {
  const base = scriptFromFixture(fixture("todo"));
  let running = 0;
  let peak = 0;
  let builds = 0;
  let release: (() => void) | null = null;
  const together = new Promise<void>((resolve) => (release = resolve));
  const script: Script = async (input, attempt) => {
    running++;
    peak = Math.max(peak, running);
    if (running >= 2) release?.();
    await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 200))]);
    running--;
    const result = await base(input, attempt);
    if (input.role !== "test" && breakFirst && builds++ === 0) {
      const path = "features/todo-add/index.ts";
      return { ...result, changes: { ...result.changes, [path]: `${result.changes[path] ?? ""}\n${BROKEN}\n` } };
    }
    return result;
  };
  const checks = new FakeCheckRunner(brokenOracle, generated);
  const w = world({ script, presets: new Map([[PROMPT, todoSpec]]), deps: { checks }, config: { specialization: { testsAlongside: true }, steps: async () => ({ plan: true, tests: true, review: true }) } });
  return { w, checks, peak: () => peak };
}

describe("tests written alongside the code", () => {
  it("writes the tests and the code at the same time and checks the result once", async () => {
    const { w, checks, peak } = alongside();
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(peak()).toBe(2);
    expect(w.coder.turns.map((t) => t.role).sort()).toEqual(["backend", "test"]);
    const states = w.bus.log.flatMap((e) => (e.type === "session.state" ? [e.to] : []));
    expect(states).not.toContain("testing");
    const lanes = w.bus.log.find((e) => e.type === "lanes.started");
    expect(lanes?.type === "lanes.started" && lanes.lanes.map((l) => l.role).sort()).toEqual(["backend", "test"]);
    const forkRuns = checks.runs.filter((r) => r.repo !== "demo").map((r) => r.commitId);
    expect(forkRuns.length).toBeGreaterThan(0);
    expect(new Set(forkRuns).size).toBe(forkRuns.length);
  });

  it("sends the code back before review when it fails the new tests, and keeps the tests", async () => {
    const { w } = alongside(true);
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(w.coder.turns.map((t) => t.role).sort()).toEqual(["backend", "backend", "test"]);
    const order = w.bus.log.flatMap((e) => (e.type === "agent.started" ? [e.role] : e.type === "gate.result" ? [e.ok ? "gate ok" : "gate red"] : []));
    const red = order.indexOf("gate red");
    expect(red).toBeGreaterThan(-1);
    expect(order.slice(0, red)).not.toContain("reviewer");
    expect(w.coder.turns.at(-1)?.prompt).toContain("fails its feature's tests");
  });
});
