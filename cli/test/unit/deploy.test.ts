import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureMemoryIndex, instanceConfig, MEMORY_DIMENSIONS, parseJsonc, type Runner } from "../../src/deploy.ts";
import { REPO_ROOT } from "../../src/world.ts";

const base = parseJsonc(readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8"));

describe("deploy", () => {
  it("reads the root wrangler config that the Deploy to Cloudflare button uses", () => {
    expect(base).toMatchObject({ name: "chef", main: "workers/src/index.ts", assets: { directory: "apps/dashboard/dist" } });
    expect(parseJsonc('{\n  // note\n  "a": "x // not a comment", /* gone */ "b": [1, 2,],\n}')).toEqual({ a: "x // not a comment", b: [1, 2] });
  });

  it("keeps the main chef's resource names and gives a named copy its own", () => {
    expect(instanceConfig(base, "chef")).toBe(base);
    const copy = instanceConfig(base, "trial");
    expect(copy).toMatchObject({
      name: "trial",
      artifacts: [{ binding: "ARTIFACTS", namespace: "trial" }],
      workflows: [{ binding: "UPSTREAM_SYNC", name: "trial-upstream-sync" }],
      vectorize: [{ binding: "MEMORY", index_name: "trial-memory" }],
      triggers: { events: [{ filter: { namespace: "trial" }, targets: [{ workflow_name: "trial-upstream-sync" }] }] },
      vars: { PROJECT_WORKER_PREFIX: "trial-", CODER_MODEL: (base["vars"] as Record<string, string>)["CODER_MODEL"] },
    });
    expect(copy["durable_objects"]).toEqual(base["durable_objects"]);
  });

  it("creates the memory index only when it is missing and never stops the deploy over it", async () => {
    const calls: string[][] = [];
    const runner =
      (codes: Record<string, number>): Runner =>
      async (args) => {
        calls.push([...args]);
        return { code: codes[args[1] as string] ?? 0, output: "permission denied" };
      };
    const log: string[] = [];
    await ensureMemoryIndex(runner({}), "chef-memory", (l) => log.push(l));
    expect(calls).toEqual([["vectorize", "get", "chef-memory"]]);
    calls.length = 0;
    await ensureMemoryIndex(runner({ get: 1 }), "chef-memory", (l) => log.push(l));
    expect(calls[1]).toEqual(["vectorize", "create", "chef-memory", `--dimensions=${MEMORY_DIMENSIONS}`, "--metric=cosine"]);
    await ensureMemoryIndex(runner({ get: 1, create: 1 }), "chef-memory", (l) => log.push(l));
    expect(log.at(-1)).toContain("deploying anyway");
  });
});
