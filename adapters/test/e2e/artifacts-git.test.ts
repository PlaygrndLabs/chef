import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, parseNote } from "@chef/core";
import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";
import webHttp from "isomorphic-git/http/web";
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

  it("reads a project that does not exist yet as empty, then bootstraps it", async () => {
    const host = new ArtifactsRepoHost(server.control());
    const w = world({ script: scriptFromFixture(fixture("todo")), deps: { repos: host }, config: { name: "fresh-git" } });
    expect(await w.orchestrator.mainTree()).toEqual({ commitId: null, tree: {} });
    const commitId = await w.orchestrator.bootstrap(templateTree());
    expect((await w.orchestrator.mainTree()).commitId).toBe(commitId);
  });

  it("keeps every note when several writers add notes at once", async () => {
    const control = server.control();
    const setup = new ArtifactsRepoHost(control);
    await setup.createRepo("notes-race", { defaultBranch: "main" });
    const write = await setup.createToken("notes-race", "write", 600);
    const first = await setup.commit(write, { ref: "main", parent: null, changes: { "a.txt": "a\n" }, message: "init", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    const ids = [first.id];
    for (let i = 0; i < 4; i++) ids.push((await setup.commit(write, { ref: "main", parent: ids.at(-1) as string, changes: { "a.txt": `${i}\n` }, message: `c${i}`, author: { name: "t", email: "ma.karimi76@gmail.com" } })).id);
    await Promise.all(ids.map(async (id, i) => {
      const host = new ArtifactsRepoHost(control);
      const token = await host.createToken("notes-race", "write", 600);
      await host.addNote(token, { namespace: NOTES_NAMESPACE, commitId: id, note: `note ${i}` });
    }));
    const reader = new ArtifactsRepoHost(control);
    expect(await Promise.all(ids.map((id) => reader.readNote("notes-race", NOTES_NAMESPACE, id)))).toEqual(ids.map((_, i) => `note ${i}`));
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

describe("ArtifactsRepoHost with the Artifacts read API and a small cache", () => {
  it("reads commits, logs and notes through the read API and agrees with git", async () => {
    const control = server.control({ read: true });
    const host = new ArtifactsRepoHost(control);
    await host.createRepo("reads", { defaultBranch: "main" });
    const write = await host.createToken("reads", "write", 600);
    const author = { name: "t", email: "ma.karimi76@gmail.com" };
    const first = await host.commit(write, { ref: "main", parent: null, changes: { "a.txt": "a\n", "dir/b.txt": "b\n" }, message: "init", author });
    const second = await host.commit(write, { ref: "main", parent: first.id, changes: { "dir/b.txt": "B\n" }, message: "second", author });
    await host.addNote(write, { namespace: NOTES_NAMESPACE, commitId: second.id, note: "hello" });

    const reader = new ArtifactsRepoHost(control);
    server.reads.length = 0;
    expect(await reader.resolveRef("reads", "main")).toBe(second.id);
    expect((await reader.readCommit("reads", second.id))?.tree).toEqual({ "a.txt": "a\n", "dir/b.txt": "B\n" });
    expect((await reader.log("reads", "main")).map((c) => c.message)).toEqual(["second", "init"]);
    expect(await reader.readNote("reads", NOTES_NAMESPACE, second.id)).toBe("hello");
    expect(await reader.readNote("reads", NOTES_NAMESPACE, first.id)).toBeNull();
    expect(server.reads.length).toBeGreaterThan(0);
    expect(reader.cachedRepos).toEqual([]);
    expect(await reader.resolveRef("reads", "nope")).toBeNull();
    expect(await reader.resolveRef("missing-repo", "main")).toBeNull();
  });

  it("deletes a repo and forgets it", async () => {
    const host = new ArtifactsRepoHost(server.control({ read: true }));
    await host.createRepo("gone", { defaultBranch: "main" });
    const write = await host.createToken("gone", "write", 600);
    await host.commit(write, { ref: "main", parent: null, changes: { "a.txt": "a" }, message: "init", author: { name: "t", email: "ma.karimi76@gmail.com" } });
    expect(await host.deleteRepo("gone")).toBe(true);
    expect(await host.info("gone")).toBeNull();
    expect(await host.resolveRef("gone", "main")).toBeNull();
    expect(await host.deleteRepo("gone")).toBe(false);
  });

  it("runs the loop end to end with one cached repo at a time and deletes the fork after the merge", async () => {
    const host = new ArtifactsRepoHost(server.control({ read: true }), { maxRepos: 1 });
    const PROMPT = "Add an item to a todo list";
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), deps: { repos: host }, config: { name: "small-cache" } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state, record.machine.reason).toBe("merged");
    expect(host.cachedRepos.length).toBeLessThanOrEqual(1);
    expect(await host.info(record.fork)).toBeNull();
    expect(server.gitLog("small-cache")).toContain("spec: mark todo-add merged");
    expect((await w.orchestrator.turns(sessionId as string)).every((t) => t.note !== null)).toBe(true);
  });
});

describe("ArtifactsRepoHost when the git server has a bad moment", () => {
  const author = { name: "t", email: "ma.karimi76@gmail.com" };
  const failure = (request: GitHttpRequest): GitHttpResponse => ({ url: request.url, method: request.method, headers: {}, statusCode: 500, statusMessage: "Internal Server Error", body: [new TextEncoder().encode("oops")] as unknown as GitHttpResponse["body"] });
  const flaky = (plan: (request: GitHttpRequest) => "pass" | "fail" | "fail-after"): HttpClient => ({
    async request(request) {
      const step = plan(request);
      if (step === "fail") return failure(request);
      const response = await webHttp.request(request);
      if (step === "fail-after") {
        for await (const chunk of response.body ?? []) void chunk;
        return failure(request);
      }
      return response;
    },
  });
  const wait = async () => undefined;

  it("retries reads and pushes that hit a server error", async () => {
    const setup = new ArtifactsRepoHost(server.control());
    await setup.createRepo("flaky", { defaultBranch: "main" });
    const first = await setup.commit(await setup.createToken("flaky", "write", 600), { ref: "main", parent: null, changes: { "a.txt": "a\n" }, message: "init", author });
    const seen = { refs: 0, pushes: 0 };
    const host = new ArtifactsRepoHost(server.control(), {
      wait,
      http: flaky((request) => {
        if (request.url.includes("info/refs") && seen.refs++ === 0) return "fail";
        if (request.method === "POST" && request.url.endsWith("/git-receive-pack") && seen.pushes++ === 0) return "fail";
        return "pass";
      }),
    });
    const second = await host.commit(await host.createToken("flaky", "write", 600), { ref: "lane/backend", parent: null, changes: { "b.txt": "b\n" }, message: "lane", author });
    expect(seen.pushes).toBe(2);
    expect(await setup.resolveRef("flaky", "lane/backend")).toBe(second.id);
    expect(await setup.resolveRef("flaky", "main")).toBe(first.id);
  });

  it("treats a push the server applied before failing as done", async () => {
    const setup = new ArtifactsRepoHost(server.control());
    await setup.createRepo("applied", { defaultBranch: "main" });
    let pushes = 0;
    const host = new ArtifactsRepoHost(server.control(), { wait, http: flaky((request) => (request.method === "POST" && request.url.endsWith("/git-receive-pack") && pushes++ === 0 ? "fail-after" : "pass")) });
    const commit = await host.commit(await host.createToken("applied", "write", 600), { ref: "main", parent: null, changes: { "a.txt": "a\n" }, message: "init", author });
    expect(pushes).toBe(1);
    expect(await setup.resolveRef("applied", "main")).toBe(commit.id);
  });

  it("names the branch and repo when a push keeps failing", async () => {
    const setup = new ArtifactsRepoHost(server.control());
    await setup.createRepo("down", { defaultBranch: "main" });
    const host = new ArtifactsRepoHost(server.control(), { wait, http: flaky((request) => (request.method === "POST" && request.url.endsWith("/git-receive-pack") ? "fail" : "pass")) });
    await expect(host.commit(await host.createToken("down", "write", 600), { ref: "lane/frontend", parent: null, changes: { "a.txt": "a\n" }, message: "init", author })).rejects.toThrow(/^push lane\/frontend to down: HTTP Error: 500/);
  });
});
