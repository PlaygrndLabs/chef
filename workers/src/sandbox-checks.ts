import { parseTap, tapFailures } from "@chef/core/tap";
import { diffTrees, lintSpecFiles, previewName, type CheckResult, type CheckRunner, type PreviewDeployment, type PreviewHost, type ProofRecord, type ProofRunner, type RepoHost, type Tree } from "@chef/core";
import { gateModule, previewMain, PREVIEW_GATE_FILE } from "@chef/adapters/preview-gate";
import { PLACEHOLDER, type CloudflareGrant } from "./sandbox-grants.ts";
import type { ChecksJob, CommandResult } from "./session-agent.ts";

type ChecksStub = { runChecks(job: ChecksJob, cloudflareToken?: string | null): Promise<CommandResult[]> };

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

async function job(repos: RepoHost, repo: string, commitId: string, commands: ChecksJob["commands"], allowHosts: readonly string[] = [], ref?: string): Promise<Omit<ChecksJob, "sessionId"> & { token: () => Promise<void> }> {
  const info = await repos.info(repo);
  if (!info) throw new Error(`unknown repo ${repo}`);
  const token = await repos.createToken(repo, "read", 900);
  return { remote: info.remote, ref: ref ?? info.defaultBranch, commitId, readToken: token.secret, commands, allowHosts, token: () => repos.revokeToken(token) };
}

function sessionOf(repo: string): string {
  return repo.split("--").at(-1) ?? repo;
}

export class SandboxCheckRunner implements CheckRunner {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
  ) {}

  async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
    const sessionId = sessionOf(input.repo);
    const base = input.commitId.split("+")[0] as string;
    const baseCommit = base === input.commitId ? null : await this.repos.readCommit(input.repo, base);
    if (base !== input.commitId && !baseCommit) throw new Error(`unknown base commit ${base} in ${input.repo}`);
    const prepared = await job(this.repos, input.repo, base, [
      { name: "typecheck", argv: ["npx", "tsc", "-p", "tsconfig.json"] },
      { name: "test", argv: ["node", "--test", "--test-reporter=tap", "--experimental-strip-types", "features/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"] },
      { name: "generated", argv: ["npm", "run", "--silent", "app", "--", "gen", "--check"] },
      { name: "lint", argv: ["node", "/opt/chef/template/lint.mjs"] },
    ]);
    const stub = this.sessions.get(this.sessions.idFromName(sessionId)) as unknown as ChecksStub;
    let results: CommandResult[];
    try {
      const { token, ...rest } = prepared;
      void token;
      results = await stub.runChecks({ ...rest, sessionId, ...(baseCommit ? { overlay: diffTrees(baseCommit.tree, input.tree) } : {}) });
    } finally {
      await prepared.token();
    }
    const specFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(input.tree)) if (path.startsWith("spec/")) specFiles[path] = content;
    const spec = lintSpecFiles(specFiles).problems;
    return [
      ...results.map((r) => ({ name: r.name, ok: r.code === 0, log: (r.name === "test" && r.code !== 0 ? tapFailures(r.stdout) : "") || tail(`${r.stdout}\n${r.stderr}`) || `${r.name} ok`, ...(r.name === "test" ? { cases: parseTap(r.stdout) } : {}) })),
      { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" },
    ];
  }
}

export class SandboxProofRunner implements ProofRunner {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
    private readonly pass: (url: string) => Promise<ChecksJob["previewPass"] | null> = async () => null,
  ) {}

  async prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord> {
    const repo = input.repo;
    const prepared = await job(this.repos, repo, input.commitId, [{ name: "proof", argv: ["npm", "run", "--silent", "app", "--", "proof", input.feature, "--url", input.url, "--commit", input.commitId] }], [new URL(input.url).hostname]);
    const stub = this.sessions.get(this.sessions.idFromName(sessionOf(repo))) as unknown as ChecksStub;
    const previewPass = await this.pass(input.url);
    let result: CommandResult | undefined;
    try {
      const { token, ...rest } = prepared;
      void token;
      result = (await stub.runChecks({ ...rest, sessionId: sessionOf(repo), ...(previewPass ? { previewPass } : {}) }))[0];
    } finally {
      await prepared.token();
    }
    let parsed: { ok?: boolean; steps?: ProofRecord["steps"] } = {};
    try {
      parsed = JSON.parse(result?.stdout ?? "") as typeof parsed;
    } catch {
      parsed = { ok: false, steps: [{ name: "run proof", ok: false, detail: tail(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, 10) }] };
    }
    return { feature: input.feature, flow: input.flow, url: input.url, commitId: input.commitId, ok: result?.code === 0 && parsed.ok === true, steps: parsed.steps ?? [], at: Date.now() };
  }
}

interface PreviewOutput {
  readonly preview?: { readonly urls?: readonly string[] };
  readonly deployment?: { readonly id?: string; readonly urls?: readonly string[] };
}

export function parsePreview(stdout: string, commitId: string): PreviewDeployment {
  const start = stdout.indexOf("{");
  let output: PreviewOutput;
  try {
    output = JSON.parse(start === -1 ? "" : stdout.slice(start)) as PreviewOutput;
  } catch {
    throw new Error(`wrangler preview printed no JSON: ${tail(stdout, 10)}`);
  }
  const url = output.preview?.urls?.[0] ?? output.deployment?.urls?.[0];
  if (!url || !output.deployment?.id) throw new Error(`wrangler preview returned no URL: ${tail(stdout, 10)}`);
  return { url, versionId: output.deployment.id, commitId };
}

export function lostCreateRace(output: string): boolean {
  return /\[code: 10040\]/.test(output);
}

export class SandboxPreviewHost implements PreviewHost {
  private readonly latest = new Map<string, PreviewDeployment>();

  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
    private readonly grant: CloudflareGrant,
    private readonly apiToken: string,
    private readonly prepare: () => Promise<((preview: string) => Promise<void>) | undefined> = async () => undefined,
  ) {}

  async deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment> {
    const name = previewName(input.branch, this.grant.worker);
    const settle = await this.prepare();
    const commit = await this.repos.readCommit(input.repo, input.commitId);
    if (!commit) throw new Error(`unknown commit ${input.commitId} in ${input.repo}`);
    const overlay = { [PREVIEW_GATE_FILE]: gateModule(previewMain(commit.tree)) };
    const env = { CLOUDFLARE_API_TOKEN: PLACEHOLDER, CLOUDFLARE_ACCOUNT_ID: this.grant.accountId, WRANGLER_SEND_METRICS: "false", CI: "true" };
    const command = { name: "preview", argv: ["npx", "wrangler", "preview", PREVIEW_GATE_FILE, "--name", name, "--worker-name", this.grant.worker, "--json"], timeoutMs: 300_000, env };
    let result: CommandResult | undefined;
    for (let attempt = 1; ; attempt++) {
      const prepared = await job(this.repos, input.repo, input.commitId, [command], [], input.branch);
      const stub = this.sessions.get(this.sessions.idFromName(`preview-${name}`)) as unknown as ChecksStub;
      try {
        const { token, ...rest } = prepared;
        void token;
        result = (await stub.runChecks({ ...rest, sessionId: `preview-${name}`, cloudflare: this.grant, overlay }, this.apiToken))[0];
      } finally {
        await prepared.token();
      }
      if (attempt === 1 && result && result.code !== 0 && lostCreateRace(`${result.stdout}\n${result.stderr}`)) continue;
      break;
    }
    if (!result || result.code !== 0) throw new Error(`wrangler preview failed: ${tail(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, 20)}`);
    const parsed = parsePreview(result.stdout, input.commitId);
    if (settle) await settle(name);
    const deployment = { ...parsed, gated: true };
    this.latest.set(input.branch, deployment);
    return deployment;
  }

  async current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null> {
    return this.latest.get(input.branch) ?? null;
  }
}

export class SandboxLiveHost {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
    private readonly grant: CloudflareGrant,
    private readonly apiToken: string,
  ) {}

  async deploy(input: { repo: string; commitId: string }): Promise<void> {
    const env = { CLOUDFLARE_API_TOKEN: PLACEHOLDER, CLOUDFLARE_ACCOUNT_ID: this.grant.accountId, WRANGLER_SEND_METRICS: "false", CI: "true" };
    const command = { name: "live", argv: ["npx", "wrangler", "deploy", "--name", this.grant.worker], timeoutMs: 300_000, env };
    const sessionId = `live-${this.grant.worker}`;
    const prepared = await job(this.repos, input.repo, input.commitId, [command]);
    const stub = this.sessions.get(this.sessions.idFromName(sessionId)) as unknown as ChecksStub;
    let result: CommandResult | undefined;
    try {
      const { token, ...rest } = prepared;
      void token;
      result = (await stub.runChecks({ ...rest, sessionId, cloudflare: this.grant }, this.apiToken))[0];
    } finally {
      await prepared.token();
    }
    if (!result || result.code !== 0) throw new Error(`wrangler deploy failed: ${tail(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, 20)}`);
  }
}
