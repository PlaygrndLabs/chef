import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ArtifactsRepoHost } from "@chef/adapters/artifacts";
import { LocalGitHost } from "@chef/adapters/local-git";
import { parseFeature, PreviewKeeper, type ChefEvent } from "@chef/core";
import { MemoryStore } from "@chef/core/fakes";
import { demoScript } from "../../src/demo.ts";
import { readTree } from "../../src/fs.ts";
import { Docker } from "../../src/engine/docker.ts";
import { DockerCheckRunner, DockerPreviewHost, DockerProofRunner } from "../../src/engine/sandbox.ts";
import { localWorld, REPO_ROOT, templateTree } from "../../src/world.ts";

const PROMPT = "Add an item to a todo list";
const enabled = process.env["CHEF_DOCKER_E2E"] === "1";

describe.skipIf(!enabled)("the Docker sandbox on this computer", () => {
  const root = mkdtempSync(join(tmpdir(), "chef-sandbox-"));
  const git = new LocalGitHost(join(root, "repos"));
  const docker = new Docker({ repos: git.root, network: process.env["CHEF_SANDBOX_NETWORK"] === "host" ? "host" : "bridge" });
  const previews = new DockerPreviewHost(docker, "e2e");

  afterAll(async () => {
    await previews.remove();
    await git.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("runs the checks, a live preview and the proof of a feature in containers, then merges it", async () => {
    await git.start();
    await docker.prepare((line) => process.stderr.write(`${line}\n`));
    const repos = new ArtifactsRepoHost(git.control({ read: true }));
    const store = new MemoryStore();
    const clock = { now: () => Date.now() };
    const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
    if (!spec.ok) throw new Error(spec.errors.join("\n"));
    const keeper = new PreviewKeeper(previews, previews, { repos, store, clock, canonical: "demo" });
    const w = localWorld({
      script: demoScript(readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo"))),
      presets: new Map([[PROMPT, spec.spec]]),
      deps: { repos, store, clock, previews: keeper, checks: new DockerCheckRunner(docker, repos), proofs: new DockerProofRunner(docker, repos, previews) },
      config: { name: "demo", previewLink: (key) => `/preview/demo/${key}` },
    });
    const events: ChefEvent[] = [];
    w.bus.subscribe((event) => events.push(event));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    if (!sessionId) throw new Error("no session");
    const record = await w.orchestrator.run(sessionId, 60);

    const gates = events.filter((e): e is Extract<ChefEvent, { type: "gate.result" }> => e.type === "gate.result");
    expect(gates.at(-1)?.checks.map((c) => [c.name, c.ok])).toEqual(expect.arrayContaining([["typecheck", true], ["test", true], ["lint", true], ["spec-lint", true], ["proof", true]]));
    expect(record.machine.state).toBe("merged");
    const preview = await keeper.current({ repo: "demo", branch: "preview/todo-add" });
    expect(preview?.url).toMatch(/^http:\/\/localhost:\d+$/);
    const page = await fetch(preview?.url ?? "");
    expect(page.status).toBe(200);
  }, 900_000);
});
