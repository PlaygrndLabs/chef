import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, parseNote } from "@kargah/core";
import { ArtifactsRepoHost } from "../../src/artifacts.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../../../core/test/harness.ts";
import { LocalGitServer } from "../git-server.ts";

const server = new LocalGitServer();

beforeAll(() => server.start());
afterAll(() => server.stop());

describe("ArtifactsRepoHost over real git smart HTTP", () => {
  it("commits, merges, pushes previews and notes through git", async () => {
    const host = new ArtifactsRepoHost(server.control());
    await host.createRepo("p1", { defaultBranch: "main" });
    const write = await host.createToken("p1", "write", 600);
    const first = await host.commit(write, { ref: "main", parent: null, changes: { "a.txt": "one\ntwo\nthree\n", "b.txt": "b\n" }, message: "init", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    expect(await host.resolveRef("p1", "main")).toBe(first.id);

    await host.fork("p1", "p1--f--s1");
    const forkWrite = await host.createToken("p1--f--s1", "write", 600);
    const onFork = await host.commit(forkWrite, { ref: "main", parent: first.id, changes: { "a.txt": "ONE\ntwo\nthree\n" }, message: "fork edit", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    await host.addNote(forkWrite, { namespace: NOTES_NAMESPACE, commitId: onFork.id, note: '{"hello":1}\n' });
    const onMain = await host.commit(write, { ref: "main", parent: first.id, changes: { "a.txt": "one\ntwo\nTHREE\n" }, message: "main edit", author: { name: "t", email: "ma.karimi76@gmail.com" } });

    const synced = await host.merge(forkWrite, { into: "main", from: { repo: "p1", ref: "main" }, message: "sync", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    expect(synced.status).toBe("merged");
    const merged = await host.readCommit("p1--f--s1", (synced as { commitId: string }).commitId);
    expect(merged?.tree["a.txt"]).toBe("ONE\ntwo\nTHREE\n");
    expect(merged?.parents).toEqual([onFork.id, onMain.id]);

    await host.pushRef(write, { ref: "preview/f", commitId: merged?.id as string, fromRepo: "p1--f--s1", force: true });
    expect(await host.resolveRef("p1", "preview/f")).toBe(merged?.id);
    expect(server.gitNotes("p1", NOTES_NAMESPACE, onFork.id)).toContain('"hello"');

    const read = await host.createToken("p1", "read", 600);
    await expect(host.commit(read, { ref: "main", parent: onMain.id, changes: { "c.txt": "x" }, message: "nope", author: { name: "t", email: "ma.karimi76@gmail.com" } })).rejects.toThrow();
  });

  it("runs the phase 1 loop end to end on real git repos", async () => {
    const host = new ArtifactsRepoHost(server.control());
    const PROMPT = "Add an item to a todo list";
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), deps: { repos: host }, config: { name: "demo-git" } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state, record.machine.reason).toBe("merged");
    const log = server.gitLog("demo-git");
    expect(log).toContain("spec: mark todo-add merged");
    const head = log.split("\n")[0]?.split(" ")[0] as string;
    expect(parseNote(server.gitNotes("demo-git", NOTES_NAMESPACE, head))?.rootPrompt).toBe(PROMPT);
    expect(server.gitLog("demo-git", "preview/todo-add").split("\n")[0]).toContain(head);
  });
});
