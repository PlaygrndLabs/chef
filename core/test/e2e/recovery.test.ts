import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/session/record.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

describe("recovering from a restart in the middle of a step", () => {
  it("adopts the commit its interrupted step pushed instead of getting stuck", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    while ((await w.orchestrator.session(id)).machine.state !== "coding") await w.orchestrator.step(id);
    const saved = structuredClone(await w.orchestrator.session(id));
    await w.orchestrator.step(id);
    const pushed = await w.repos.resolveRef(saved.fork, "main");
    expect(pushed).not.toBe(saved.head);
    await w.deps.store.put<SessionRecord>(`session/${id}`, saved);

    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");
    expect(record.commits).toContain(pushed);
  });

  it("redoes a step after a Durable Object reset instead of getting stuck", async () => {
    const todo = scriptFromFixture(fixture("todo"));
    let resets = 1;
    const w = world({
      script: (input, attempt) => {
        if (input.role !== "test" && resets-- > 0) throw new Error("Durable Object reset because its code was updated.");
        return todo(input, attempt);
      },
      presets: new Map([[PROMPT, todoSpec]]),
    });
    await w.orchestrator.bootstrap(templateTree());
    const record = await w.orchestrator.run((await w.orchestrator.submit(PROMPT)).sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(resets).toBeLessThan(0);
  });

  it("still gives up when the reset keeps happening", async () => {
    const w = world({
      script: () => {
        throw new Error("Durable Object reset because its code was updated.");
      },
      presets: new Map([[PROMPT, todoSpec]]),
    });
    await w.orchestrator.bootstrap(templateTree());
    const record = await w.orchestrator.run((await w.orchestrator.submit(PROMPT)).sessionId as string);
    expect(record.machine).toMatchObject({ state: "stuck", reason: expect.stringContaining("reset because its code was updated") });
  });
});
