import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/orchestrator/orchestrator.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const TODO = "Add an item to a todo list";
const EDIT_AND_DELETE = "Let people edit and delete items in the todo list";
const SPLITS = new Map([
  [
    EDIT_AND_DELETE,
    [
      { kind: "new", prompt: "Let people delete an item from the todo list", parent: "todo-add" },
      { kind: "new", prompt: "Let people edit an item in the todo list", parent: "todo-add" },
    ] as const,
  ],
]);

async function todoWithParts() {
  const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]), splits: SPLITS });
  await w.orchestrator.bootstrap(templateTree());
  await w.orchestrator.run((await w.orchestrator.submit(TODO)).sessionId as string);
  const parts = await w.orchestrator.submit(EDIT_AND_DELETE);
  const [remove, edit] = await Promise.all(parts.sessionIds.map((id) => w.orchestrator.session(id)));
  if (!remove || !edit) throw new Error("the request did not split in two");
  return { w, remove, edit };
}

describe("arranging the feature tree", () => {
  it("renames and moves features, and the router sees the new names and places", async () => {
    const { w, edit } = await todoWithParts();
    await w.orchestrator.arrange("todo-add", { title: "Todo list" });
    await w.orchestrator.arrange(edit.featureId, { parent: null });
    expect(await w.orchestrator.layout()).toEqual({ "todo-add": { title: "Todo list" }, [edit.featureId]: { parent: null } });
    expect(w.bus.log.filter((e) => e.type === "feature.arranged")).toMatchObject([
      { featureId: "todo-add", title: "Todo list", parent: null },
      { featureId: edit.featureId, title: null, parent: null },
    ]);
    await w.orchestrator.route("Show how many items are left");
    await w.orchestrator.submit("Show how many items are left");
    expect(w.planner.splitAsked.at(-1)?.spec.find((f) => f.id === "todo-add")?.title).toBe("Todo list");
  });

  it("refuses to put a feature under itself or one of its own parts", async () => {
    const { w, remove } = await todoWithParts();
    await expect(w.orchestrator.arrange("todo-add", { parent: remove.featureId })).rejects.toBeInstanceOf(ControlError);
    await expect(w.orchestrator.arrange("todo-add", { parent: "todo-add" })).rejects.toBeInstanceOf(ControlError);
    await expect(w.orchestrator.arrange("nothing-here", { title: "x" })).rejects.toBeInstanceOf(ControlError);
  });

  it("deletes a live feature with its parts, takes its code off main and stops the parts' builds", async () => {
    const { w, remove, edit } = await todoWithParts();
    const result = await w.orchestrator.removeFeature("todo-add");
    expect(result.featureIds).toEqual(["todo-add", remove.featureId, edit.featureId]);
    expect(result.reverted).toBe(false);
    expect(result.commitId).not.toBeNull();
    const main = await w.orchestrator.mainTree();
    expect(main.commitId).toBe(result.commitId);
    expect(Object.keys(main.tree).filter((p) => p.startsWith("features/todo-add/"))).toEqual([]);
    expect(readSpec(main.tree).map((f) => f.id)).not.toContain("todo-add");
    expect((await w.orchestrator.session(remove.id)).machine.state).toBe("dropped");
    expect((await w.orchestrator.session(edit.id)).machine.state).toBe("dropped");
    const layout = await w.orchestrator.layout();
    expect(result.featureIds.every((id) => typeof layout[id]?.removedAt === "number")).toBe(true);
    expect(w.bus.log.at(-1)).toMatchObject({ type: "features.removed", featureIds: result.featureIds, commitId: result.commitId });
    await expect(w.orchestrator.removeFeature("todo-add")).rejects.toBeInstanceOf(ControlError);
  });
});
