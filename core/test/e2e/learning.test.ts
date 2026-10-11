import { describe, expect, it } from "vitest";
import { exportOutcomes } from "../../src/learning/export.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";

describe("phase 5 learning export on fakes", () => {
  it("exports a reverted change as a reject and the fixed change as an approve, with each coder turn labelled by the review it led to", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed on main: list order differs", 1, "demo");
    const { sessionId } = await w.orchestrator.submit(prompt);
    expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");

    const { reviews, turns } = await exportOutcomes({ log: w.bus.log, repos: w.repos, canonical: w.orchestrator.canonical, sessions: await w.orchestrator.sessions() });
    expect(reviews.map((r) => [r.outcome, r.label])).toEqual([
      ["reverted", "reject"],
      ["merged", "approve"],
    ]);
    const [first] = reviews;
    expect(first?.messages[0]?.content).toContain("Feature todo-add: Add an item to a todo list");
    expect(first?.messages[0]?.content).toContain("--- features/todo-add/index.ts");
    expect(first?.messages[1]).toEqual({ role: "assistant", content: "reject: a case the acceptance criteria imply is not handled or not tested" });

    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => t.sessionId === sessionId && t.prompt.length > 0 && Object.keys(t.changes).length > 0)).toBe(true);
    expect(turns.map((t) => [t.role, t.kind, t.outcome, t.label])).toEqual([
      ["test", "test", "reverted", "negative"],
      ["backend", "code", "reverted", "negative"],
    ]);
  });
});
