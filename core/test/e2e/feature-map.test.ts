import { describe, expect, it } from "vitest";
import { MAP_PROMPT, readFeatureMap, wasMapped } from "../../src/features/index.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

describe("mapping a project's current features on fakes", () => {
  it("lists a feature Chef built as current, then explores main from the chat and writes how to start the project", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([["Add an item to a todo list", todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit("Add an item to a todo list");
    expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");
    const built = readFeatureMap((await w.orchestrator.mainTree()).tree);
    expect(built.features).toEqual([{ id: todoSpec.id, name: todoSpec.id, parent: null, title: todoSpec.title, state: "current", specs: "", path: `Open ${todoSpec.entrypoint}.` }]);
    expect(wasMapped((await w.orchestrator.mainTree()).tree)).toBe(false);

    const result = await w.orchestrator.submit(MAP_PROMPT);
    expect(result.sessionIds).toEqual([]);
    expect(result.answer?.text).toBe("The feature list already has every feature I could find in the code.");
    const { map } = await w.orchestrator.featureMap();
    expect(map.start).toContain("start the app");
    expect(map.features).toEqual(built.features);
    const log = await w.repos.log("demo", "main", 1);
    expect(log[0]?.message).toBe("Feature list: how to start the project");
    expect(wasMapped((await w.orchestrator.mainTree()).tree)).toBe(true);
  });

  it("turns a wish into a current feature where it is when Chef builds it", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([["Add an item to a todo list", todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.editFeatureMap({ kind: "add", parent: null, title: "Todos", state: "current", path: "Open /todos." });
    const wish = await w.orchestrator.editFeatureMap({ kind: "add", parent: "todos", title: "Todo add" });
    expect(wish.id).toBe("todos/todo-add");
    const { sessionId } = await w.orchestrator.submit("Add an item to a todo list");
    expect((await w.orchestrator.session(sessionId as string)).featureId).toBe("todo-add");
    expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");
    const map = readFeatureMap((await w.orchestrator.mainTree()).tree);
    expect(map.features.map((f) => [f.id, f.state, f.title])).toEqual([
      ["todos", "current", "Todos"],
      ["todos/todo-add", "current", "Todo add"],
    ]);
  });

  it("adds a wish under a mapped feature and routes a change to a mapped feature by its short name", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([["Add an item to a todo list", todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.editFeatureMap({ kind: "add", parent: null, title: "Boards", state: "current", path: "Open /boards." });
    const wish = await w.orchestrator.editFeatureMap({ kind: "add", parent: "boards", title: "Board sharing" });
    expect(wish.id).toBe("boards/board-sharing");
    const map = readFeatureMap((await w.orchestrator.mainTree()).tree);
    expect(map.features.map((f) => [f.id, f.state])).toEqual([["boards", "current"], ["boards/board-sharing", "wish"]]);
    const routed = await w.orchestrator.submit("#boards fix the board title");
    expect(routed.decision).toMatchObject({ intent: "change_feature", featureId: "boards" });
    expect((await w.orchestrator.session(routed.sessionId as string)).featureId).toBe("boards");
  });
});
