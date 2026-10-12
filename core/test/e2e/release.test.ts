import { describe, expect, it } from "vitest";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

describe("releasing a session's resources", () => {
  it("stops the sandbox once when a session merges, gets stuck or is dropped", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), config: { previewLink: (key) => `/preview/demo/${key}` } });
    await w.orchestrator.bootstrap(templateTree());
    const merged = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    const record = await w.orchestrator.run(merged);
    expect(record.machine.state).toBe("merged");
    expect(record.preview?.link).toBe("/preview/demo/todo-add");
    expect(w.bus.log.some((e) => e.type === "preview.updated" && e.link === "/preview/demo/todo-add")).toBe(true);
    expect(w.coder.released).toEqual([merged]);

    const dropped = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    await w.orchestrator.step(dropped);
    await w.orchestrator.drop(dropped, "not needed");
    await w.orchestrator.step(dropped);
    expect(w.coder.released).toEqual([merged, dropped]);
  });
});
