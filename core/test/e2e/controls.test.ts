import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/orchestrator/orchestrator.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

function stuckWorld() {
  const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), config: { budget: { maxAttempts: 2, maxTokens: 1e9, maxMillis: 1e12 } } });
  return w;
}

describe("manual session controls", () => {
  it("drops a running session and refuses to drop a merged one", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const id = sessionId as string;
    await w.orchestrator.step(id);
    await w.orchestrator.step(id);
    const dropped = await w.orchestrator.drop(id, "not needed");
    expect(dropped.machine.state).toBe("dropped");
    expect((await w.orchestrator.session(id)).machine.state).toBe("dropped");
    const state = w.bus.log.filter((e) => e.type === "session.state").at(-1);
    expect(state && state.type === "session.state" ? state.reason : "").toBe("not needed");
    await expect(w.orchestrator.drop(id)).rejects.toBeInstanceOf(ControlError);
  });

  it("retries a stuck session with fresh budget and the person's guidance, then merges", async () => {
    const w = stuckWorld();
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed: expected two items", 3);
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const id = sessionId as string;
    expect((await w.orchestrator.run(id)).machine.state).toBe("stuck");
    await expect(w.orchestrator.steer(id, "late note")).rejects.toBeInstanceOf(ControlError);
    const retried = await w.orchestrator.retry(id, "Keep the items in insertion order");
    expect(retried.machine.state).toBe("coding");
    expect(retried.machine.usage.attempts).toBe(1);
    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");
    const prompts = w.coder.turns.filter((t) => t.role === "backend").map((t) => t.prompt);
    expect(prompts.some((p) => p.includes("Keep the items in insertion order") && p.includes("AC2 failed"))).toBe(true);
    await expect(w.orchestrator.retry(id, "again")).rejects.toBeInstanceOf(ControlError);
  });

  it("drops a stuck session", async () => {
    const w = stuckWorld();
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "still red", 10);
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const id = sessionId as string;
    await w.orchestrator.run(id);
    expect((await w.orchestrator.drop(id)).machine.state).toBe("dropped");
  });

  it("hands a steering note to the next coder turn once", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const id = sessionId as string;
    await w.orchestrator.steer(id, "Name the route handler addTodo");
    expect(w.bus.log.some((e) => e.type === "session.steered" && e.message === "Name the route handler addTodo")).toBe(true);
    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");
    const steered = w.coder.turns.filter((t) => t.prompt.includes("Name the route handler addTodo"));
    expect(steered).toHaveLength(1);
  });

  it("lists a session's turns with their notes and its changes against main", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const id = sessionId as string;
    for (let i = 0; i < 4; i++) await w.orchestrator.step(id);
    const turns = await w.orchestrator.turns(id);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.map((t) => t.note?.role)).toContain("planner");
    expect(turns[0]?.note?.prompt).toBeTruthy();
    const changes = await w.orchestrator.changes(id);
    expect(changes.files.map((f) => f.path)).toContain("spec/features/todo-add.md");
    expect(changes.files.find((f) => f.path === "spec/features/todo-add.md")?.before).toBeNull();
    expect((await w.orchestrator.run(id)).machine.state).toBe("merged");
    const merged = await w.orchestrator.changes(id);
    expect(merged.files.map((f) => f.path)).toContain("features/todo-add/index.ts");
  });
});
