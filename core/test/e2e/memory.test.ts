import { describe, expect, it } from "vitest";
import { renderRule, rulePath, type ProjectRule } from "../../src/checks/project-rules.ts";
import type { ChefEvent } from "../../src/events/events.ts";
import type { Script } from "../../src/fakes/index.ts";
import { featureMapProblems, lineRegex, normalizeLine } from "../../src/gardener/gardener.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";
const todo = fixture("todo");
const TEST_PATH = "features/todo-add/todo-add.test.ts";

function ofType<T extends ChefEvent["type"]>(log: readonly ChefEvent[], type: T): Extract<ChefEvent, { type: T }>[] {
  return log.filter((e): e is Extract<ChefEvent, { type: T }> => e.type === type);
}

function todoWorld(script: Script) {
  return world({ script, presets: new Map([[prompt, todoSpec]]) });
}

describe("phase 4 memory on fakes", () => {
  it("writes a lesson into the revert commit and recalls it in the reopened session and in a new project", async () => {
    const w = todoWorld(scriptFromFixture(todo));
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed on main: list order differs", 1, "demo");
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");

    const recorded = ofType(w.bus.log, "memory.recorded");
    const lesson = recorded.find((e) => e.kind === "lesson");
    expect(lesson?.path).toMatch(/^memory\/lessons\/todo-add-[0-9a-f]{12}\.md$/);
    expect(recorded.filter((e) => e.kind === "feature").map((e) => e.path)).toEqual(["memory/features/todo-add.md", "memory/features/todo-add.md"]);
    const recalled = ofType(w.bus.log, "memory.recalled");
    expect(recalled.some((e) => e.paths.includes(lesson?.path as string))).toBe(true);
    const retry = w.coder.turns.filter((t) => t.role === "backend").at(-1);
    expect(retry?.prompt).toContain("Project memory that may apply");
    expect(retry?.prompt).toContain("AC2 failed on main: list order differs");

    const main = await w.orchestrator.mainTree();
    expect(main.tree[lesson?.path as string]).toContain("kind: lesson");
    const memory = main.tree["memory/features/todo-add.md"] ?? "";
    expect(memory).toContain(`### ${record.id}`);
    expect(memory).toContain("Corrections:");

    const seeded = Object.fromEntries(Object.entries(main.tree).filter(([path]) => path.startsWith("memory/")));
    const replay = todoWorld(scriptFromFixture(todo));
    await replay.orchestrator.bootstrap({ ...templateTree(), ...seeded });
    const fresh = await replay.orchestrator.submit(prompt);
    const first = await replay.orchestrator.run(fresh.sessionId as string);
    expect(first.machine.state).toBe("merged");
    const firstTest = replay.coder.turns.find((t) => t.role === "test");
    expect(firstTest?.prompt).toContain(lesson?.path as string);
    expect(firstTest?.prompt).toContain("AC2 failed on main: list order differs");
  });

  it("keeps the feature map in step with the code on every main commit and answers questions from memory", async () => {
    const w = todoWorld(scriptFromFixture(todo));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");

    for (const commit of await w.repos.log("demo", "main", 200)) {
      const tree = (await w.repos.readCommit("demo", commit.id))?.tree ?? {};
      expect(featureMapProblems(tree), commit.message).toEqual([]);
    }
    const second = await w.orchestrator.submit("Add an item to a todo list again");
    expect(second.sessionId).not.toBeNull();
    const child = await w.orchestrator.session(second.sessionId as string);
    expect(child.parent).toBe(sessionId);

    const asked = await w.orchestrator.submit("What does the todo list feature do?");
    expect(asked.sessionId).toBeNull();
    expect(asked.answer?.sources).toContain("memory/features/todo-add.md");
    expect(asked.answer?.text).toContain("memory/features/todo-add.md");
  });

  it("rejects a turn that breaks a learned project rule and records the correction", async () => {
    const forbidden = 'assert.ok(true, "placeholder");';
    const rule: ProjectRule = { id: "mined-test", message: "Placeholder assertions were removed before", files: "**/*.test.ts", forbid: lineRegex(normalizeLine(forbidden)), source: "red-tests", evidence: ["c1", "c2", "c3"] };
    const base = scriptFromFixture(todo);
    const script: Script = async (input, attempt) => {
      const out = await base(input, attempt);
      if (input.role !== "test" || attempt > 1) return out;
      return { ...out, changes: { ...out.changes, [TEST_PATH]: `${todo[TEST_PATH]}\ntest("AC9: placeholder", () => {\n  ${forbidden.replace('"placeholder"', '"later"')}\n});\n` } };
    };
    const w = todoWorld(script);
    await w.orchestrator.bootstrap({ ...templateTree(), [rulePath(rule.id)]: renderRule(rule) });
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(ofType(w.bus.log, "turn.rejected").map((e) => [e.role, e.rule, e.paths])).toEqual([["test", "project-lint", [TEST_PATH]]]);
    const retry = w.coder.turns.filter((t) => t.role === "test").at(-1);
    expect(retry?.prompt).toContain("mined-test");
    expect(ofType(w.bus.log, "correction.recorded").map((e) => [e.role, e.signature])).toEqual([["test", "project-lint"]]);
    expect(record.history.some((h) => h.includes("project lint rule"))).toBe(true);
    const main = await w.orchestrator.mainTree();
    expect(main.tree[TEST_PATH]).toBe(todo[TEST_PATH]);
  });
});
