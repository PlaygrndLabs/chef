import { describe, expect, it } from "vitest";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { historyResponse } from "../../src/orchestrator/history-request.ts";

const PROMPT = "Add an item to a todo list";

describe("main's history", () => {
  it("lists main's commits newest first with the turn notes, and diffs each against its first parent", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    expect(await w.orchestrator.history()).toEqual({ head: null, commits: [], more: false });
    await w.orchestrator.bootstrap(templateTree());
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");

    const history = await w.orchestrator.history();
    const head = (await w.orchestrator.mainTree()).commitId;
    expect(history.head).toBe(head);
    expect(history.commits[0]?.id).toBe(head);
    expect(history.more).toBe(false);
    const first = history.commits.at(-1);
    expect(first?.parents).toEqual([]);
    expect(history.commits.some((c) => c.note?.session === id && c.note.feature === "todo-add")).toBe(true);

    const coded = history.commits.find((c) => c.note?.kind === "code");
    const changes = await w.orchestrator.commitChanges(coded?.id as string);
    expect(changes?.commit.id).toBe(coded?.id);
    expect(changes?.files.length).toBeGreaterThan(0);
    expect(changes?.files.every((f) => f.before !== f.after)).toBe(true);

    const bootstrap = await w.orchestrator.commitChanges(first?.id as string);
    expect(bootstrap?.files.every((f) => f.before === null)).toBe(true);

    const short = await w.orchestrator.history(1);
    expect(short.commits).toHaveLength(1);
    expect(short.more).toBe(true);
  });

  it("answers the history routes", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const listed = (await (await historyResponse(w.orchestrator, null, "2")).json()) as { commits: { id: string }[] };
    expect(listed.commits.length).toBeGreaterThan(0);
    const one = await historyResponse(w.orchestrator, listed.commits[0]?.id as string, null);
    expect(one.status).toBe(200);
    expect((await historyResponse(w.orchestrator, "0000000", null)).status).toBe(404);
  });
});
