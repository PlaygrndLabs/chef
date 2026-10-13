import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deploy, ensureMemoryIndex, instanceConfig, MEMORY_DIMENSIONS, movedConfig, parseJsonc, withImage, type Runner } from "../../src/deploy.ts";
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

  it("moves the main chef to a new name with its projects, repos, memory and live apps", () => {
    const tags = (base["migrations"] as { tag: string }[]).map((m) => m.tag);
    const moved = movedConfig(base, "chef-dev", `chef@${tags.at(-1) ?? ""}`);
    expect(moved).toMatchObject({
      name: "chef-dev",
      artifacts: base["artifacts"],
      vectorize: base["vectorize"],
      vars: { PROJECT_WORKER_PREFIX: "" },
      workflows: [{ binding: "UPSTREAM_SYNC", name: "chef-dev-upstream-sync" }],
      triggers: { events: [{ filter: { namespace: "chef" }, targets: [{ workflow_name: "chef-dev-upstream-sync" }] }] },
    });
    expect(moved["migrations"]).toEqual([
      {
        tag: tags.at(-1),
        transferred_classes: ["ProjectAgent", "SessionAgent", "Settings"].map((cls) => ({ from: cls, from_script: "chef", to: cls })),
      },
    ]);
    const later = movedConfig({ ...base, migrations: [...(base["migrations"] as unknown[]), { tag: "v9", new_sqlite_classes: ["Later"] }] }, "chef-dev", "chef@v2");
    expect((later["migrations"] as { tag: string }[]).map((m) => m.tag)).toEqual(["v2", "v9"]);
    expect(() => movedConfig(base, "chef-dev", "chef@nope")).toThrow("--moved-from");
  });

  it("points every sandbox image at a prebuilt one, so a deploy needs no Docker", () => {
    const image = "registry.cloudflare.com/0123/chef-sandbox@sha256:abc";
    const config = withImage(base, image);
    expect(config["containers"]).toEqual([{ ...(base["containers"] as Record<string, unknown>[])[0], images: { coder: { image } } }]);
    expect(config["durable_objects"]).toEqual(base["durable_objects"]);
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

  it("moves the Durable Objects before turning on containers when Cloudflare refuses both at once", async () => {
    const calls: string[][] = [];
    const run: Runner = async (args) => {
      calls.push([...args]);
      if (args[0] !== "deploy") return { code: 0, output: "" };
      const deploys = calls.filter((c) => c[0] === "deploy").length;
      if (deploys === 1) return { code: 1, output: "Cannot enable containers in a Durable Objects class 'SessionAgent' if it is not a SQLite Durable Object [code: 10074]" };
      return { code: 0, output: "https://chef-dev.example.workers.dev" };
    };
    const result = await deploy({ name: "chef-dev", movedFrom: "chef@v2", run, log: () => {} });
    const deploys = calls.filter((c) => c[0] === "deploy");
    expect(deploys).toHaveLength(3);
    const second = deploys[1] ?? [];
    const first = second[second.indexOf("--config") + 1] ?? "";
    expect(first.endsWith(".wrangler.chef-dev.move.jsonc")).toBe(true);
    const moved = parseJsonc(readFileSync(first, "utf8"));
    expect(moved["containers"]).toBeUndefined();
    expect((moved["migrations"] as { transferred_classes?: unknown[] }[])[0]?.transferred_classes).toHaveLength(3);
    expect(deploys[2]).toEqual(deploys[0]);
    expect(result).toMatchObject({ code: 0, url: "https://chef-dev.example.workers.dev" });
  });
  it("deploys again when Cloudflare could not finish the container settings", async () => {
    const calls: string[][] = [];
    const run: Runner = async (args) => {
      calls.push([...args]);
      if (args[0] !== "deploy") return { code: 0, output: "" };
      const deploys = calls.filter((c) => c[0] === "deploy").length;
      if (deploys === 1) return { code: 1, output: "The Worker version was deployed, but Wrangler could not finish applying its Durable Object-managed Container application settings." };
      return { code: 0, output: "https://chef-dev.example.workers.dev" };
    };
    const result = await deploy({ name: "chef-dev", movedFrom: "chef@v2", run, log: () => {} });
    const deploys = calls.filter((c) => c[0] === "deploy");
    expect(deploys).toHaveLength(2);
    expect(deploys[1]).toEqual(deploys[0]);
    expect(result).toMatchObject({ code: 0, url: "https://chef-dev.example.workers.dev" });
  });
});
