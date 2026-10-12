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

describe("forks after a session ends", () => {
  it("deletes the fork after a merge and still serves the session's turns and changes from main", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");
    expect(record.forkDeleted).toBe(true);
    expect(w.repos.repos.has(record.fork)).toBe(false);
    expect(w.bus.log.some((e) => e.type === "fork.deleted" && e.sessionId === id && e.archived === null)).toBe(true);
    const turns = await w.orchestrator.turns(id);
    expect(turns.length).toBe(record.commits.length);
    expect(turns.every((t) => t.note !== null && t.message.length > 0)).toBe(true);
    expect((await w.orchestrator.changes(id)).files.some((f) => f.path === "features/todo-add/index.ts")).toBe(true);
  });

  it("keeps a dropped session's work on an archive branch before deleting its fork", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    for (let i = 0; i < 3; i++) await w.orchestrator.step(id);
    const head = (await w.orchestrator.session(id)).head;
    await w.orchestrator.drop(id, "changed my mind");
    const record = await w.orchestrator.session(id);
    expect(record.forkDeleted).toBe(true);
    expect(await w.repos.resolveRef("demo", `archive/${id}`)).toBe(head);
    expect((await w.orchestrator.turns(id)).every((t) => t.note !== null)).toBe(true);
  });

  it("deletes forks of sessions that ended before forks were cleaned up", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    const record = await w.orchestrator.run(id);
    await w.repos.fork("demo", record.fork);
    await w.deps.store.put(`session/${id}`, { ...record, forkDeleted: false, released: null });
    expect(await w.orchestrator.reclaim()).toBe(1);
    expect(w.repos.repos.has(record.fork)).toBe(false);
    expect(await w.orchestrator.reclaim()).toBe(0);
  });

  it("forks again when a merged feature is reverted later, and merges it again", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    const record = await w.orchestrator.run(id);
    expect(record.forkDeleted).toBe(true);
    expect(await w.orchestrator.revertMerge(record.merge?.commitId as string, "monitor: down")).not.toBeNull();
    const reopened = await w.orchestrator.session(id);
    expect(reopened.machine.state).toBe("coding");
    expect(reopened.forkDeleted).toBe(false);
    expect(w.repos.repos.has(record.fork)).toBe(true);
    const again = await w.orchestrator.run(id);
    expect(again.machine.state).toBe("merged");
    expect(w.repos.repos.has(record.fork)).toBe(false);
  });
});
