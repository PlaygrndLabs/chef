import { describe, expect, it } from "vitest";
import type { EnvVar } from "../../src/env/env.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";

describe("project environment", () => {
  it("waits for a missing key before the gate and carries on once it is set", async () => {
    let env: EnvVar[] = [{ name: "APP_TITLE", secret: false }];
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, { ...todoSpec, env: ["TODO_API_KEY"] }]]), config: { environment: async () => env } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);

    const waiting = (await w.orchestrator.drain(50)).find((s) => s.id === sessionId);
    expect(waiting?.machine.state).toBe("gating");
    expect(waiting?.needs).toEqual(["TODO_API_KEY"]);
    expect(w.bus.log.filter((e) => e.type === "session.needs")).toHaveLength(1);
    expect(w.proofs.proofs).toHaveLength(0);
    const backend = w.coder.turns.find((t) => t.role === "backend");
    expect(backend?.prompt).toContain("context.env");
    expect(backend?.prompt).toContain("Set in this project: APP_TITLE.");
    expect(backend?.prompt).toContain("Not set yet: TODO_API_KEY");

    expect(await w.orchestrator.environmentChanged()).toEqual([]);
    env = [...env, { name: "TODO_API_KEY", secret: true }];
    expect(await w.orchestrator.environmentChanged()).toEqual([sessionId]);
    const done = (await w.orchestrator.drain(50)).find((s) => s.id === sessionId);
    expect(done?.machine.state).toBe("merged");
    expect(done?.needs).toEqual([]);
    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(readSpec(main?.tree ?? {}).find((f) => f.id === "todo-add")?.env).toEqual(["TODO_API_KEY"]);
  });

  it("does not wait when the feature needs no keys", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), config: { environment: async () => [] } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(w.bus.log.some((e) => e.type === "session.needs")).toBe(false);
    expect(w.coder.turns.every((t) => !t.prompt.includes("context.env"))).toBe(true);
  });
});
