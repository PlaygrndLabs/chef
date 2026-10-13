import { describe, expect, it } from "vitest";
import type { RuleReviewer } from "../../src/fakes/rule-reviewer.ts";
import { scopeFor } from "../../src/profiles/profile.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { fixture, profiles, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const TODO = "Add an item to a todo list";
const EDIT_AND_DELETE = "Let people edit and delete items in the todo list";

describe("splitting a request into features", () => {
  it("builds each part as its own session under the feature it extends", async () => {
    const splits = new Map([
      [
        EDIT_AND_DELETE,
        [
          { kind: "new", prompt: "Let people delete an item from the todo list", parent: "todo-add" },
          { kind: "new", prompt: "Let people edit an item in the todo list", parent: "todo-add" },
        ] as const,
      ],
    ]);
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]), splits });
    await w.orchestrator.bootstrap(templateTree());
    const todo = await w.orchestrator.submit(TODO);
    expect(w.planner.splitAsked.map((s) => s.prompt)).toEqual([TODO]);
    expect((await w.orchestrator.run(todo.sessionId as string)).machine.state).toBe("merged");

    const result = await w.orchestrator.submit(EDIT_AND_DELETE);
    expect(result.sessionIds).toHaveLength(2);
    const records = await Promise.all(result.sessionIds.map((id) => w.orchestrator.session(id)));
    expect(records.map((r) => r.featureId)).toEqual(["let-people-delete-item-from-todo-list", "let-people-edit-item-todo-list"]);
    expect(records.map((r) => r.plan.feature.parent)).toEqual(["todo-add", "todo-add"]);
    expect(records.map((r) => r.ask)).toEqual(["Let people delete an item from the todo list", "Let people edit an item in the todo list"]);
    expect(records.map((r) => r.rootPrompt)).toEqual([EDIT_AND_DELETE, EDIT_AND_DELETE]);
    expect(records.map((r) => r.decision.intent)).toEqual(["new_feature", "new_feature"]);
    expect(records.map((r) => r.parent)).toEqual([null, null]);
    const backend = profiles()["backend"];
    if (!backend) throw new Error("no backend role");
    const scope = scopeFor(backend, records[0]?.plan.feature ?? todoSpec);
    expect(scope).toContain("features/todo-add/**");
    expect(scope).toContain("!features/todo-add/flow.ts");
  });

  it("keeps one request as one feature when the planner does not split it", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const result = await w.orchestrator.submit(TODO);
    expect(result.sessionIds).toHaveLength(1);
    expect((await w.orchestrator.session(result.sessionId as string)).ask).toBeUndefined();
  });

  it("skips splitting for explicit commands and writes the parent into the spec", async () => {
    const splits = new Map([["Let people delete an item", [{ kind: "new", prompt: "Let people delete an item", parent: "todo-add" }] as const]]);
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]), splits });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.run((await w.orchestrator.submit(TODO)).sessionId as string);
    await w.orchestrator.submit("#todo-add Let people delete an item");
    expect(w.planner.splitAsked.map((s) => s.prompt)).toEqual([TODO]);
    const child = await w.orchestrator.submit("Let people delete an item");
    const record = await w.orchestrator.session(child.sessionId as string);
    expect(record.plan.feature.parent).toBe("todo-add");
    expect(record.ask).toBeUndefined();
    for (let i = 0; i < 3; i++) await w.orchestrator.step(record.id);
    const fork = await w.repos.readCommit(record.fork, (await w.orchestrator.session(record.id)).head as string);
    expect(readSpec(fork?.tree ?? {}).find((f) => f.id === record.featureId)?.parent).toBe("todo-add");
  });

  it("tells the reviewer a child feature may change its parent's files", async () => {
    const splits = new Map([["Let people delete an item", [{ kind: "new", prompt: "Let people delete an item", parent: "todo-add" }] as const]]);
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]), splits });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.run((await w.orchestrator.submit(TODO)).sessionId as string);
    const reviewer = w.deps.reviewer as RuleReviewer;
    const before = reviewer.reviews.length;
    await w.orchestrator.run((await w.orchestrator.submit("Let people delete an item")).sessionId as string);
    const review = reviewer.reviews[before];
    expect(review?.feature.parent).toBe("todo-add");
    expect(review?.scope).toEqual(expect.arrayContaining(["features/let-people-delete-item/**", "features/todo-add/**"]));
    expect(review?.scope?.some((pattern) => pattern.startsWith("!"))).toBe(false);
  });
});

describe("the main chat's memory", () => {
  it("sends earlier messages with a new request and reports how full the chat's memory is", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.submit(TODO);
    await w.orchestrator.submit("Let people delete an item");
    const asked = w.planner.splitAsked.at(-1);
    expect(asked?.conversation).toContain(`Person: ${TODO}`);
    expect(asked?.conversation).toContain("chef: Started the feature:");
    expect(w.planner.splitAsked[0]?.conversation).toBeUndefined();
    expect((await w.orchestrator.chatMemory()).turns.map((t) => t.prompt)).toEqual([TODO, "Let people delete an item"]);
    const contexts = w.bus.log.filter((e) => e.type === "chat.context");
    expect(contexts).toHaveLength(2);
    expect(contexts.at(-1)).toMatchObject({ turns: 2, summarized: 0, limit: 8000 });
  });

  it("summarizes older messages when the chat fills up", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    for (let i = 0; i < 40; i++) await w.orchestrator.submit(`/chore Tidy part ${i} of the docs ${"so it reads better ".repeat(40)}`);
    const memory = await w.orchestrator.chatMemory();
    expect(memory.summary).toContain("Tidy part 0");
    expect(w.planner.compacted.length).toBeGreaterThan(0);
    expect(memory.turns.at(-1)?.prompt).toContain("Tidy part 39");
    expect(memory.summarized).toBe(40 - memory.turns.length);
    const last = w.bus.log.filter((e) => e.type === "chat.context").at(-1);
    expect(last).toMatchObject({ summarized: memory.summarized });
    expect(last?.type === "chat.context" && last.used <= last.limit).toBe(true);
  });
});
