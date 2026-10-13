import { createServer } from "node:net";
import { parseTap } from "@chef/core/tap";
import { diffTrees, lintSpecFiles, type CheckResult, type CheckRunner, type Coder, type CoderEvent, type CoderTurnInput, type CoderTurnResult, type PreviewDeployment, type PreviewHost, type PreviewSpace, type ProofRecord, type ProofRunner, type RepoHost, type Tree } from "@chef/core";
import { NO_LLM } from "@chef/adapters/settings";
import type { Docker } from "./docker.ts";

const TS = "--experimental-strip-types";
const CHECKS = [
  { name: "typecheck", argv: ["npx", "tsc", "-p", "tsconfig.json"] },
  { name: "test", argv: ["node", "--test", "--test-reporter=tap", TS, "features/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"] },
  { name: "generated", argv: ["npm", "run", "--silent", "app", "--", "gen", "--check"] },
  { name: "lint", argv: ["node", "/opt/chef/template/lint.mjs"] },
];

interface Command {
  readonly name: string;
  readonly argv: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

interface CommandResult {
  readonly name: string;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

function slug(text: string, max = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "x";
}

function sessionOf(repo: string): string {
  return repo.split("--").at(-1) ?? repo;
}

export function repoPath(repo: string): string {
  return `/repos/${repo}.git`;
}

export function reachableFromSandbox(url: string, docker: Docker): string {
  if (docker.network === "host") return url;
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/, "$1host.docker.internal");
}

async function runCommands(docker: Docker, input: { readonly name: string; readonly repo: string; readonly ref: string; readonly commitId: string; readonly commands: readonly Command[]; readonly overlay?: Readonly<Record<string, string | null>> }): Promise<CommandResult[]> {
  const job = { sessionId: input.name, remote: repoPath(input.repo), ref: input.ref, commitId: input.commitId, commands: input.commands, ...(input.overlay ? { overlay: input.overlay } : {}) };
  let results: CommandResult[] | null = null;
  const run = await docker.run({
    script: "checks.mjs",
    job,
    name: `chef-${input.name}-${Date.now().toString(36)}`,
    onLine: (line) => {
      try {
        const parsed = JSON.parse(line) as { type?: string; results?: CommandResult[] };
        if (parsed.type === "chef.checks" && parsed.results) results = parsed.results;
      } catch {
        return;
      }
    },
  });
  if (!results) throw new Error(`the sandbox exited with ${run.code} before it reported results: ${tail(run.stderr, 20)}`);
  return results;
}

export class DockerCoder implements Coder {
  constructor(
    private readonly docker: Docker,
    private readonly options: { readonly model: string; readonly llm: { readonly baseUrl: string; readonly apiKey: string } | null },
  ) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const llm = this.options.llm;
    if (!llm) throw new Error(NO_LLM);
    const job = {
      sessionId: input.sessionId,
      featureId: input.featureId,
      role: input.role,
      model: input.model === "coder-default" ? this.options.model : input.model,
      prompt: input.prompt,
      agent: input.agent,
      writeScope: input.writeScope,
      remote: repoPath(input.workspace.repo),
      ref: input.workspace.ref,
      commitId: input.workspace.commitId,
      llm: { baseUrl: reachableFromSandbox(llm.baseUrl, this.docker) },
    };
    let result: Omit<CoderTurnResult, "runId"> | null = null;
    const runId = `${input.sessionId}-${Date.now().toString(36)}`;
    const run = await this.docker.run({
      script: "runner.mjs",
      job,
      name: `chef-coder-${slug(runId, 60)}`,
      env: { CHEF_LLM_KEY: llm.apiKey },
      ...(input.signal ? { signal: input.signal } : {}),
      onLine: (line) => {
        let event: { type?: string } & Record<string, unknown>;
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          return;
        }
        if (event.type === "chef.result") result = event as unknown as Omit<CoderTurnResult, "runId">;
        else if (event.type) input.onEvent(event as unknown as CoderEvent);
      },
    });
    const output = result as Omit<CoderTurnResult, "runId"> | null;
    if (run.code !== 0 || !output) throw new Error(`the coder sandbox exited with ${run.code}: ${tail(run.stderr, 20)}`);
    return { changes: output.changes, summary: output.summary, model: output.model, runId, usage: output.usage ?? { inputTokens: 0, outputTokens: 0 } };
  }
}

export class DockerCheckRunner implements CheckRunner {
  constructor(
    private readonly docker: Docker,
    private readonly repos: RepoHost,
  ) {}

  async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
    const base = input.commitId.split("+")[0] as string;
    const baseCommit = base === input.commitId ? null : await this.repos.readCommit(input.repo, base);
    if (base !== input.commitId && !baseCommit) throw new Error(`unknown base commit ${base} in ${input.repo}`);
    const info = await this.repos.info(input.repo);
    if (!info) throw new Error(`unknown repo ${input.repo}`);
    const results = await runCommands(this.docker, { name: `checks-${slug(sessionOf(input.repo))}`, repo: input.repo, ref: info.defaultBranch, commitId: base, commands: CHECKS, ...(baseCommit ? { overlay: diffTrees(baseCommit.tree, input.tree) } : {}) });
    const specFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(input.tree)) if (path.startsWith("spec/")) specFiles[path] = content;
    const spec = lintSpecFiles(specFiles).problems;
    return [
      ...results.map((r) => ({ name: r.name, ok: r.code === 0, log: tail(`${r.stdout}\n${r.stderr}`) || `${r.name} ok`, ...(r.name === "test" ? { cases: parseTap(r.stdout) } : {}) })),
      { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" },
    ];
  }
}

export class DockerProofRunner implements ProofRunner {
  constructor(
    private readonly docker: Docker,
    private readonly repos: RepoHost,
    private readonly previews: { inside(url: string): string },
  ) {}

  async prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord> {
    const info = await this.repos.info(input.repo);
    if (!info) throw new Error(`unknown repo ${input.repo}`);
    const url = this.previews.inside(input.url);
    const [result] = await runCommands(this.docker, { name: `proof-${slug(sessionOf(input.repo))}`, repo: input.repo, ref: info.defaultBranch, commitId: input.commitId, commands: [{ name: "proof", argv: ["npm", "run", "--silent", "app", "--", "proof", input.feature, "--url", url, "--commit", input.commitId] }] });
    let parsed: { ok?: boolean; steps?: ProofRecord["steps"] } = {};
    try {
      parsed = JSON.parse(result?.stdout ?? "") as typeof parsed;
    } catch {
      parsed = { ok: false, steps: [{ name: "run proof", ok: false, detail: tail(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, 10) }] };
    }
    return { feature: input.feature, flow: input.flow, url: input.url, commitId: input.commitId, ok: result?.code === 0 && parsed.ok === true, steps: parsed.steps ?? [], at: Date.now() };
  }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, until: number, alive: () => boolean): Promise<void> {
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      return;
    } catch {
      if (!alive()) throw new Error("the preview stopped while it was starting");
      if (Date.now() > until) throw new Error(`the preview did not answer at ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

interface Running {
  readonly name: string;
  readonly port: number;
  readonly deployment: PreviewDeployment;
}

export class DockerPreviewHost implements PreviewHost, PreviewSpace {
  private readonly running = new Map<string, Running>();

  constructor(
    private readonly docker: Docker,
    private readonly project: string,
    private readonly environment: () => Promise<readonly { readonly name: string; readonly value: string }[]> = async () => [],
    private readonly startMs = 180_000,
  ) {}

  async deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment> {
    await this.docker.prepare();
    const key = slug(input.branch.replace(/^preview\//, ""), 40);
    const name = `chef-preview-${slug(this.project, 30)}-${key}`;
    const previous = this.running.get(input.branch);
    this.docker.remove(name);
    const port = previous?.port ?? (await freePort());
    const listen = this.docker.network === "host" ? ["--ip", "127.0.0.1", "--port", String(port)] : ["--ip", "0.0.0.0", "--port", "8787"];
    const vars = (await this.environment()).flatMap((v) => ["--var", `${v.name}:${v.value}`]);
    const job = { sessionId: `preview-${key}`, remote: repoPath(input.repo), ref: input.branch, commitId: input.commitId, commands: [{ name: "preview", argv: ["npx", "wrangler", "dev", ...listen, ...vars, "--show-interactive-dev-session=false"], timeoutMs: 7 * 24 * 3600_000, env: { WRANGLER_SEND_METRICS: "false", CI: "true" } }] };
    const env = { CHEF_JOB: Buffer.from(JSON.stringify(job)).toString("base64") };
    const started = await this.docker.exec([...this.docker.runArgs({ name, env, publish: port, detach: true, labels: [`chef-project=${this.project}`] }), "node", "/opt/chef/checks.mjs"], { env: this.docker.containerEnv(env) });
    if (started.code !== 0) throw new Error(`starting the preview failed: ${tail(started.stderr, 20)}`);
    const url = `http://localhost:${port}`;
    try {
      await waitFor(`http://127.0.0.1:${port}/`, Date.now() + this.startMs, () => this.docker.running(name));
    } catch (error) {
      const logs = await this.docker.exec(["logs", "--tail", "40", name]);
      this.docker.remove(name);
      throw new Error(`${(error as Error).message}: ${tail(`${logs.stdout}\n${logs.stderr}`, 30)}`, { cause: error });
    }
    const deployment = { url, versionId: `${name}@${input.commitId.slice(0, 12)}`, commitId: input.commitId };
    this.running.set(input.branch, { name, port, deployment });
    return deployment;
  }

  async current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null> {
    const running = this.running.get(input.branch);
    return running && this.docker.running(running.name) ? running.deployment : null;
  }

  inside(url: string): string {
    if (this.docker.network === "host") return url;
    const port = Number(new URL(url).port);
    const running = [...this.running.values()].find((r) => r.port === port);
    return running ? url.replace(/^http:\/\/localhost:\d+/, `http://${running.name}:8787`) : reachableFromSandbox(url, this.docker);
  }

  async remove(): Promise<void> {
    this.docker.removeLabelled(`chef-project=${this.project}`);
    this.running.clear();
  }
}
