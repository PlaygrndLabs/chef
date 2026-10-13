import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactsRepoHost, tokenSecret } from "../../src/artifacts.ts";
import { GitRemote } from "../../src/external-git.ts";
import { fixture, generated, scriptFromFixture, templateTree, todoSpec, world } from "../../../core/test/harness.ts";
import { LocalGitServer } from "../git-server.ts";

const server = new LocalGitServer();

beforeAll(() => server.start());
afterAll(() => server.stop());

const author = { name: "someone", email: "someone@example.com" };

describe("linking an external git repo over smart HTTP", () => {
  it("imports it, builds on Artifacts, mirrors to the sync branch and merges new upstream commits", async () => {
    const control = server.control({ read: true });
    const upstream = new ArtifactsRepoHost(control);
    await upstream.createRepo("ext-up", { defaultBranch: "main" });
    const upstreamWrite = await upstream.createToken("ext-up", "write", 3600);
    const template = templateTree();
    const first = await upstream.commit(upstreamWrite, { ref: "main", parent: null, changes: { ...template, "src/registry.gen.ts": generated["src/registry.gen.ts"](template) }, message: "Existing project", author });

    const PROMPT = "Add an item to a todo list";
    const host = new ArtifactsRepoHost(control);
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), deps: { repos: host }, config: { name: "linked" } });
    const remote = new GitRemote({ url: server.remote("ext-up"), branch: "main", token: tokenSecret(upstreamWrite.secret) }, control);
    expect(await remote.head()).toBe(first.id);
    const sync = w.orchestrator.external(remote, { mode: "branch", syncBranch: "chef" });

    expect((await sync.pull()).status).toBe("imported");
    expect(await host.resolveRef("linked", "main")).toBe(first.id);

    const id = (await w.orchestrator.submit(PROMPT)).sessionId as string;
    expect((await w.orchestrator.run(id)).machine.state).toBe("merged");
    expect((await sync.push()).status).toBe("pushed");
    const main = (await host.resolveRef("linked", "main")) as string;
    expect(server.gitLog("ext-up", "chef").split("\n")[0]?.split(" ")[0]).toBe(main);
    expect(server.gitLog("ext-up", "main").split("\n")[0]?.split(" ")[0]).toBe(first.id);

    await upstream.commit(upstreamWrite, { ref: "main", parent: first.id, changes: { "docs/notes.md": "from upstream\n" }, message: "Upstream notes", author });
    expect((await sync.pull()).status).toBe("merged");
    expect((await w.orchestrator.mainTree()).tree["docs/notes.md"]).toBe("from upstream\n");
    await expect(remote.push({ repo: "linked", ref: "main", commitId: main, branch: "main", force: true })).rejects.toThrow(/never pushes to main/);
  });
});
