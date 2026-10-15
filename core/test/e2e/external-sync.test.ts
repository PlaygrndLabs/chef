import { describe, expect, it } from "vitest";
import { MemoryExternalRemote } from "../../src/fakes/index.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { fixture, generated, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import type { Script } from "../../src/fakes/index.ts";

const PROMPT = "Add an item to a todo list";
const todo = fixture("todo");
const INDEX = "features/todo-add/index.ts";

function regenerated(tree: Record<string, string>) {
  return { ...tree, "src/registry.gen.ts": generated["src/registry.gen.ts"](tree) };
}

async function linked(script: Script = scriptFromFixture(todo), mode: "branch" | "pull-request" | "feature-pull-requests" = "pull-request") {
  const w = world({ script, presets: new Map([[PROMPT, todoSpec]]) });
  await w.repos.createRepo("upstream");
  const remote = new MemoryExternalRemote(w.repos, "upstream");
  await remote.commit(regenerated(templateTree()), "Existing project");
  const sync = w.orchestrator.external(remote, { mode, syncBranch: "chef", mainAppLink: "https://chef.example/app/demo/main" });
  return { w, remote, sync };
}

describe("an optional external git link", () => {
  it("imports the linked repo, builds on Artifacts, and syncs back only through a branch and a pull request", async () => {
    const { w, remote, sync } = await linked();
    const imported = await sync.pull();
    expect(imported.status).toBe("imported");
    const upstreamMain = await remote.head();
    expect(await w.repos.resolveRef("demo", "main")).toBe(upstreamMain);

    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    expect((await w.orchestrator.run(id)).machine.state).toBe("merged");
    const pushed = await sync.push();
    expect(pushed.status).toBe("pushed");
    expect(await remote.head()).toBe(upstreamMain);
    expect(await remote.head("chef")).toBe(await w.repos.resolveRef("demo", "main"));
    const pr = remote.pullRequests.get("chef");
    expect(pr?.title).toBe("Chef: Add an item to a todo list");
    expect(pr?.body).toContain("https://chef.example/app/demo/main");
    expect((await sync.push()).status).toBe("up-to-date");

    await remote.merge("chef");
    expect((await sync.pull()).status).toBe("merged");
    expect(await sync.pending((await w.repos.resolveRef("demo", "main")) as string)).toEqual([]);
    expect(remote.pushes.every((p) => p.branch !== "main")).toBe(true);
  });

  it("merges new commits on the linked main into Artifacts main and marks running sessions for sync", async () => {
    const { w, remote, sync } = await linked();
    await sync.pull();
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    await w.orchestrator.step(id);
    await w.orchestrator.step(id);
    await remote.commit({ "docs/notes.md": "written outside Chef\n" }, "Add notes");
    const pulled = await sync.pull();
    expect(pulled.status).toBe("merged");
    const main = await w.orchestrator.mainTree();
    expect(main.tree["docs/notes.md"]).toBe("written outside Chef\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await w.orchestrator.session(id)).syncPending).toBe(true);
    const record = await w.orchestrator.run(id);
    expect(record.machine.state).toBe("merged");
    expect((await w.orchestrator.mainTree()).tree["docs/notes.md"]).toBe("written outside Chef\n");
    expect(w.bus.log.some((e) => e.type === "external.pulled" && e.status === "merged")).toBe(true);
  });

  it("hands a conflicting change on the linked main to the conflict resolver, then merges it", async () => {
    const base = scriptFromFixture(todo);
    const script: Script = (input, attempt) => (input.featureId === "sync" ? { changes: { [INDEX]: todo[INDEX] as string }, summary: "resolved" } : base(input, attempt));
    const { w, remote, sync } = await linked(script);
    await sync.pull();
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    expect((await w.orchestrator.run(id)).machine.state).toBe("merged");
    await remote.commit({ [INDEX]: "export const routes = [];\n" }, "Someone else started todo-add");
    const outcome = await sync.pull();
    expect(outcome.status, JSON.stringify(outcome)).toBe("resolved");
    expect((await w.orchestrator.mainTree()).tree[INDEX]).toBe(todo[INDEX]);
    expect(w.coder.turns.some((t) => t.featureId === "sync" && t.role === "conflict-resolver" && t.writeScope.includes(INDEX))).toBe(true);
    expect([...w.repos.repos.keys()].some((name) => name.includes("--sync--"))).toBe(false);
    expect(w.bus.log.some((e) => e.type === "external.conflict")).toBe(true);
    expect((await sync.pull()).status).toBe("up-to-date");
  });

  it("stops retrying a linked head it could not resolve until the head changes", async () => {
    const base = scriptFromFixture(todo);
    const script: Script = (input, attempt) => (input.featureId === "sync" ? { changes: {} } : base(input, attempt));
    const { w, remote, sync } = await linked(script);
    await sync.pull();
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    await w.orchestrator.run(id);
    const conflicting = await remote.commit({ [INDEX]: "export const routes = [];\n" }, "Someone else started todo-add");
    expect((await sync.pull()).status).toBe("stuck");
    expect(await sync.pull()).toEqual({ status: "waiting", commitId: conflicting });
    const turns = w.coder.turns.length;
    await sync.retry();
    expect((await sync.pull()).status).toBe("stuck");
    expect(w.coder.turns.length).toBeGreaterThan(turns);
  });

  it("opens one pull request per feature on a branch cut from the linked main", async () => {
    const { w, remote, sync } = await linked(scriptFromFixture(todo), "feature-pull-requests");
    await sync.pull();
    const upstreamMain = await remote.head();
    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    await w.orchestrator.run(id);
    const pushed = await sync.push();
    expect(pushed.status === "pushed" && pushed.pullRequests.length).toBe(1);
    const branchHead = (await remote.head("chef-todo-add")) as string;
    const commit = await w.repos.readCommit("upstream", branchHead);
    expect(commit?.parents).toEqual([upstreamMain]);
    expect(commit?.tree[INDEX]).toBe(todo[INDEX]);
    expect(readSpec(commit?.tree ?? {}).find((f) => f.id === "todo-add")?.status).toBe("merged");
    expect(remote.pullRequests.get("chef-todo-add")?.body).toContain("Try it in Chef's running app of main: https://chef.example/app/demo/main");
    expect(await remote.head()).toBe(upstreamMain);
  });

  it("refuses a sync branch that is the linked main", async () => {
    const w = world({ script: scriptFromFixture(todo) });
    await w.repos.createRepo("upstream");
    expect(() => w.orchestrator.external(new MemoryExternalRemote(w.repos, "upstream"), { mode: "branch", syncBranch: "main" })).toThrow(/never pushes to main/);
  });
});
