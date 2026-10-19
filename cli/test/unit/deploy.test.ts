import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deploy, ensureMemoryIndex, ensureTranscripts, instanceConfig, MEMORY_DIMENSIONS, parseJsonc, refusedToken, TOKEN_HELP, transcriptBucket, withImage, withSecret, type Runner } from "../../src/deploy.ts";
import { REPO_ROOT } from "../../src/world.ts";

const base = parseJsonc(readFileSync(join(REPO_ROOT, "wrangler.jsonc"), "utf8"));

describe("deploy", () => {
  it("reads the root wrangler config that the Deploy to Cloudflare button uses", () => {
    expect(base).toMatchObject({ name: "chef", main: "workers/src/index.ts", assets: { directory: "apps/dashboard/dist" } });
    expect(parseJsonc('{\n  // note\n  "a": "x // not a comment", /* gone */ "b": [1, 2,],\n}')).toEqual({ a: "x // not a comment", b: [1, 2] });
  });

  it("keeps the main Chef's resource names and gives a named copy its own", () => {
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

  it("gives a Worker the Deploy to Cloudflare button renamed its own resource names, keeping a memory index the person named", () => {
    const renamed = { ...base, name: "my-chef" };
    expect(instanceConfig(renamed, "my-chef")).toMatchObject({
      name: "my-chef",
      artifacts: [{ namespace: "my-chef" }],
      workflows: [{ name: "my-chef-upstream-sync" }],
      vectorize: [{ index_name: "my-chef-memory" }],
      vars: { PROJECT_WORKER_PREFIX: "my-chef-" },
    });
    const named = { ...renamed, vectorize: [{ binding: "MEMORY", index_name: "notes" }] };
    expect(instanceConfig(named, "my-chef")).toMatchObject({ vectorize: [{ index_name: "notes" }] });
  });

  it("says which token permissions to add when Cloudflare refuses the deploy's token", async () => {
    expect(refusedToken("✘ [ERROR] Unauthorized")).toBe(true);
    expect(refusedToken("Authentication error [code: 10000]")).toBe(true);
    expect(refusedToken("Build failed with 1 error")).toBe(false);
    const log: string[] = [];
    const run: Runner = async (args) => ({ code: args[0] === "deploy" ? 1 : 0, output: args[0] === "deploy" ? "POST /containers/applications: Unauthorized" : "" });
    await deploy({ name: "chef-dev", run, log: (line) => log.push(line) });
    expect(log.at(-1)).toContain(TOKEN_HELP);
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

  it("creates the transcript bucket only when it is missing, never with an expiry rule, and reports when it cannot", async () => {
    const calls: string[][] = [];
    const runner =
      (codes: Record<string, number>): Runner =>
      async (args) => {
        calls.push([...args]);
        return { code: codes[args[2] as string] ?? 0, output: "Unauthorized" };
      };
    const log: string[] = [];
    expect(await ensureTranscripts(runner({}), "chef-dev-transcripts", (l) => log.push(l))).toBe(true);
    expect(calls).toEqual([["r2", "bucket", "info", "chef-dev-transcripts"]]);
    calls.length = 0;
    expect(await ensureTranscripts(runner({ info: 1 }), "chef-dev-transcripts", (l) => log.push(l))).toBe(true);
    expect(calls.slice(1)).toEqual([["r2", "bucket", "create", "chef-dev-transcripts"]]);
    expect(await ensureTranscripts(runner({ info: 1, create: 1 }), "chef-dev-transcripts", (l) => log.push(l))).toBe(false);
    expect(log.at(-1)).toContain("keeps no copy");
    expect(transcriptBucket("chef-dev")).toBe("chef-dev-transcripts");
    expect(transcriptBucket("x".repeat(63))).toHaveLength(63);
  });

  it("binds the transcript bucket only when a deploy could make or find it", async () => {
    const configs: Record<string, unknown>[] = [];
    const runner =
      (r2: number): Runner =>
      async (args) => {
        if (args[0] === "r2") return { code: r2, output: "" };
        if (args[0] === "deploy") configs.push(parseJsonc(readFileSync(args[args.indexOf("--config") + 1] as string, "utf8")));
        return { code: 0, output: "" };
      };
    await deploy({ name: "chef-dev", run: runner(0), log: () => {} });
    await deploy({ name: "chef-dev", run: runner(1), log: () => {} });
    expect(configs[0]?.["r2_buckets"]).toEqual([{ binding: "TRANSCRIPTS", bucket_name: "chef-dev-transcripts" }]);
    expect(configs[1]?.["r2_buckets"]).toBeUndefined();
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
    const result = await deploy({ name: "chef-dev", run, log: () => {} });
    const deploys = calls.filter((c) => c[0] === "deploy");
    expect(deploys).toHaveLength(2);
    expect(deploys[1]).toEqual(deploys[0]);
    expect(result).toMatchObject({ code: 0, url: "https://chef-dev.example.workers.dev" });
  });

  it("adds one secret to the secrets file a deploy was given, or to a new one", () => {
    const dir = mkdtempSync(join(tmpdir(), "chef-test-"));
    const given = join(dir, "given.json");
    writeFileSync(given, JSON.stringify({ CF_ACCOUNT_ID: "acct" }));
    for (const args of [["--secrets-file", given, "--keep-vars"], [`--secrets-file=${given}`, "--keep-vars"]]) {
      const out = withSecret(args, "CHEF_API_KEY", "chef_k", mkdtempSync(join(tmpdir(), "chef-test-")));
      expect(out.slice(0, 2)).toEqual(["--keep-vars", "--secrets-file"]);
      expect(JSON.parse(readFileSync(out[2] as string, "utf8"))).toEqual({ CF_ACCOUNT_ID: "acct", CHEF_API_KEY: "chef_k" });
    }
    const fresh = withSecret([], "CHEF_API_KEY", "chef_k", dir);
    expect(JSON.parse(readFileSync(fresh[1] as string, "utf8"))).toEqual({ CHEF_API_KEY: "chef_k" });
  });

  it("makes a new API key for a managing app when asked, sends it as a secret and hands it back only after a deploy that worked", async () => {
    const sent: Record<string, string>[] = [];
    const runner =
      (code: number): Runner =>
      async (args) => {
        const at = args.indexOf("--secrets-file");
        if (args[0] === "deploy" && at >= 0) sent.push(JSON.parse(readFileSync(args[at + 1] as string, "utf8")) as Record<string, string>);
        return { code, output: "https://chef-dev.example.workers.dev" };
      };
    const done = await deploy({ name: "chef-dev", apiKey: true, run: runner(0), log: () => {} });
    expect(done.apiKey).toMatch(/^chef_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(sent[0]).toEqual({ CHEF_API_KEY: done.apiKey });
    expect((await deploy({ name: "chef-dev", apiKey: true, run: runner(1), log: () => {} })).apiKey).toBeNull();
    expect((await deploy({ name: "chef-dev", run: runner(0), log: () => {} })).apiKey).toBeNull();
    expect(sent).toHaveLength(2);
  });
});
