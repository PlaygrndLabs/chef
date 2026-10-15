import { describe, expect, it } from "vitest";
import type { MergeMode } from "../../src/orchestrator/orchestrator.ts";
import { runnable } from "../../src/orchestrator/orchestrator.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const TODO = "Add an item to a todo list";

describe("merging by hand", () => {
  it("waits after the checks pass until someone merges, then goes live", async () => {
    let mode: MergeMode = "manual";
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]), config: { merge: async () => mode } });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(TODO)).sessionId as string;
    const mainBefore = await w.repos.resolveRef("demo", "main");
    const waiting = await w.orchestrator.run(id);
    expect(waiting.machine.state).toBe("gating");
    expect(waiting.ready).toMatchObject({ commitId: waiting.head, approved: false });
    expect(runnable(waiting)).toBe(false);
    expect(await w.repos.resolveRef("demo", "main")).toBe(mainBefore);
    expect(w.bus.log.filter((e) => e.type === "session.ready").map((e) => e.type === "session.ready" && e.commitId)).toEqual([waiting.head]);
    const checksRun = w.bus.log.filter((e) => e.type === "gate.result").length;

    mode = "auto";
    await w.orchestrator.approveMerge(id);
    const merged = await w.orchestrator.run(id);
    expect(merged.machine.state).toBe("merged");
    expect(merged.ready).toBeNull();
    expect(await w.repos.resolveRef("demo", "main")).not.toBe(mainBefore);
    expect(w.bus.log.filter((e) => e.type === "gate.result")).toHaveLength(checksRun + 1);
    await expect(w.orchestrator.approveMerge(id)).rejects.toThrow("not waiting to be merged");
  });

  it("merges on its own by default", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const record = await w.orchestrator.run((await w.orchestrator.submit(TODO)).sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(w.bus.log.some((e) => e.type === "session.ready")).toBe(false);
  });
});
