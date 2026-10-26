import { describe, expect, it } from "vitest";
import type { Tree } from "@chef/core";
import { MemoryRepoHost, TickingClock } from "@chef/core/fakes";
import { renderRegistry } from "@chef/template/gen";
import { SandboxCheckRunner, SandboxProofRunner } from "../../src/sandbox-checks.ts";
import type { ChecksJob, CommandResult } from "../../src/session-agent.ts";

function sandbox(reply: (job: ChecksJob) => CommandResult[]) {
  const jobs: ChecksJob[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      runChecks: async (job: ChecksJob) => {
        jobs.push(job);
        return reply(job);
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { jobs, namespace };
}

async function repoWith(tree: Tree) {
  const repos = new MemoryRepoHost(new TickingClock());
  await repos.createRepo("todos--items-left--s1");
  const token = await repos.createToken("todos--items-left--s1", "write", 900);
  const commit = await repos.commit(token, { ref: "main", parent: null, changes: tree, message: "import", author: { name: "chef", email: "chef@example.com" } });
  return { repos, commitId: commit.id };
}

const imported: Tree = {
  "package.json": JSON.stringify({ name: "getting-started", scripts: { test: "jest", dev: "nodemon src/index.js" } }),
  "yarn.lock": "# yarn lockfile v1\n",
  "src/index.js": "require('express')\n",
};

const passing = (job: ChecksJob): CommandResult[] => [...(job.install ? [{ name: "install", code: 0, stdout: "done", stderr: "" }] : []), ...job.commands.map((c) => ({ name: c.name, code: 0, stdout: "Tests: 3 passed", stderr: "" }))];

describe("sandbox checks", () => {
  it("runs an imported repository's own install and test script, not the template's checks", async () => {
    const { repos, commitId } = await repoWith(imported);
    const { jobs, namespace } = sandbox(passing);
    const results = await new SandboxCheckRunner(namespace, repos, "todos").run({ repo: "todos--items-left--s1", commitId, tree: imported });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.install).toMatchObject({ argv: ["npx", "--yes", "yarn@1", "install", "--frozen-lockfile"] });
    expect(jobs[0]?.commands.map((c) => c.argv.join(" "))).toEqual(["npm run --silent test"]);
    expect(results.map((r) => [r.name, r.ok])).toEqual([["install", true], ["test", true], ["spec-lint", true]]);
    expect(results.find((r) => r.name === "test")?.log).toBe("Tests: 3 passed");
  });

  it("reports a repository with no checks of its own instead of failing", async () => {
    const tree = { "main.py": "print(1)\n" };
    const { repos, commitId } = await repoWith(tree);
    const { jobs, namespace } = sandbox(passing);
    const results = await new SandboxCheckRunner(namespace, repos, "todos").run({ repo: "todos--items-left--s1", commitId, tree });
    expect(jobs).toHaveLength(0);
    expect(results.map((r) => [r.name, r.ok])).toEqual([["checks", true], ["spec-lint", true]]);
  });

  it("keeps running the template's checks on a Chef template project", async () => {
    const tree = { "app/gen.ts": "export {};\n", "src/registry.gen.ts": renderRegistry([]), "package.json": "{}" };
    const { repos, commitId } = await repoWith(tree);
    const { jobs, namespace } = sandbox(passing);
    const results = await new SandboxCheckRunner(namespace, repos, "todos").run({ repo: "todos--items-left--s1", commitId, tree });
    expect(jobs[0]?.install).toBeUndefined();
    expect(jobs[0]?.commands.map((c) => c.name)).toEqual(["typecheck", "test", "generated", "lint"]);
    expect(results.map((r) => r.name)).toEqual(["typecheck", "test", "generated", "lint", "spec-lint"]);
  });

  it("looks at the changed features' pages on a template that has the look check", async () => {
    const tree = { "app/gen.ts": "export {};\n", "app/look.ts": "export {};\n", "src/registry.gen.ts": renderRegistry([]), "package.json": "{}" };
    const { repos, commitId } = await repoWith(tree);
    const { jobs, namespace } = sandbox(passing);
    await new SandboxCheckRunner(namespace, repos, "todos").run({ repo: "todos--items-left--s1", commitId, tree, features: ["items-left"] });
    expect(jobs[0]?.commands.map((c) => c.name)).toEqual(["typecheck", "test", "generated", "lint", "look"]);
    expect(jobs[0]?.commands.at(-1)?.argv).toEqual(["npm", "run", "--silent", "app", "--", "look", "--features", "items-left"]);
  });

  it("proves an app by asking its running app for a page the way a browser does", async () => {
    const { repos, commitId } = await repoWith(imported);
    const { jobs, namespace } = sandbox(() => [{ name: "probe", code: 0, stdout: JSON.stringify({ steps: [{ name: "GET /", ok: true, detail: "http://127.0.0.1:3000/ answered 200 OK" }] }), stderr: "" }]);
    const proof = await new SandboxProofRunner(namespace, repos, "todos").probe({ repo: "todos--items-left--s1", feature: "items-left", url: "http://127.0.0.1:3000", path: "/", commitId });
    expect(jobs[0]?.commands[0]?.argv.slice(-2)).toEqual(["http://127.0.0.1:3000/", "500"]);
    expect(jobs[0]?.commands[0]?.argv.join(" ")).toContain('accept: "text/html');
    expect(proof).toMatchObject({ ok: true, flow: "GET /", steps: [{ name: "GET /", ok: true }] });
  });
});
