import { parseTap, tapFailures } from "@chef/core/tap";
import { diffTrees, lintSpecFiles, repoChecks, usesChefTemplate, type CheckResult, type CheckRunner, type ProbeInput, type ProofRecord, type ProofRunner, type RepoHost, type Tree } from "@chef/core";
import type { ChecksJob, CommandResult } from "./session-agent.ts";

type ChecksStub = { runChecks(job: ChecksJob): Promise<CommandResult[]> };

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

async function job(repos: RepoHost, repo: string, commitId: string, commands: ChecksJob["commands"]): Promise<Omit<ChecksJob, "sessionId"> & { token: () => Promise<void> }> {
  const info = await repos.info(repo);
  if (!info) throw new Error(`unknown repo ${repo}`);
  const token = await repos.createToken(repo, "read", 900);
  return { remote: info.remote, ref: info.defaultBranch, commitId, readToken: token.secret, commands, token: () => repos.revokeToken(token) };
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
    const specFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(input.tree)) if (path.startsWith("spec/")) specFiles[path] = content;
    const spec = lintSpecFiles(specFiles).problems;
    const specLint = { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" };
    if (usesChefTemplate(input.tree)) {
      const results = await this.runCommands(input, TEMPLATE_CHECKS);
      return [...results.map((r) => ({ name: r.name, ok: r.code === 0, log: (r.name === "test" && r.code !== 0 ? tapFailures(r.stdout) : "") || tail(`${r.stdout}\n${r.stderr}`) || `${r.name} ok`, ...(r.name === "test" ? { cases: parseTap(r.stdout) } : {}) })), specLint];
    }
    const own = repoChecks(input.tree);
    const results = own.install ? await this.runCommands(input, own.commands, own.install) : [];
    return [...results.map((r) => ({ name: r.name, ok: r.code === 0, log: tail(`${r.stdout}\n${r.stderr}`, 60) || `${r.name} ok` })), ...own.notes, specLint];
  }

  private async runCommands(input: { repo: string; commitId: string; tree: Tree }, commands: ChecksJob["commands"], install?: ChecksJob["install"]): Promise<CommandResult[]> {
    const sessionId = sessionOf(input.repo);
    const base = input.commitId.split("+")[0] as string;
    const baseCommit = base === input.commitId ? null : await this.repos.readCommit(input.repo, base);
    if (base !== input.commitId && !baseCommit) throw new Error(`unknown base commit ${base} in ${input.repo}`);
    const prepared = await job(this.repos, input.repo, base, commands);
    const stub = this.sessions.get(this.sessions.idFromName(sessionId)) as unknown as ChecksStub;
    try {
      const { token, ...rest } = prepared;
      void token;
      return await stub.runChecks({ ...rest, sessionId, ...(baseCommit ? { overlay: diffTrees(baseCommit.tree, input.tree) } : {}), ...(install ? { install } : {}) });
    } finally {
      await prepared.token();
    }
  }
}

const TEMPLATE_CHECKS: ChecksJob["commands"] = [
  { name: "typecheck", argv: ["npx", "tsc", "-p", "tsconfig.json"] },
  { name: "test", argv: ["node", "--test", "--test-reporter=tap", "--experimental-strip-types", "features/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"] },
  { name: "generated", argv: ["npm", "run", "--silent", "app", "--", "gen", "--check"] },
  { name: "lint", argv: ["node", "/opt/chef/template/lint.mjs"] },
];

export class SandboxProofRunner implements ProofRunner {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
  ) {}

  async prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord> {
    const repo = input.repo;
    const prepared = await job(this.repos, repo, input.commitId, [{ name: "proof", argv: ["npm", "run", "--silent", "app", "--", "proof", input.feature, "--url", input.url, "--commit", input.commitId] }]);
    const stub = this.sessions.get(this.sessions.idFromName(sessionOf(repo))) as unknown as ChecksStub;
    let result: CommandResult | undefined;
    try {
      const { token, ...rest } = prepared;
      void token;
      result = (await stub.runChecks({ ...rest, sessionId: sessionOf(repo) }))[0];
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

  async probe(input: ProbeInput): Promise<ProofRecord> {
    const flow = `GET ${input.path}`;
    const limit = input.path === "/" ? 500 : 400;
    const prepared = await job(this.repos, input.repo, input.commitId, [{ name: "probe", argv: ["node", "--input-type=module", "-e", PROBE, new URL(input.path, input.url).href, String(limit)] }]);
    const stub = this.sessions.get(this.sessions.idFromName(sessionOf(input.repo))) as unknown as ChecksStub;
    let result: CommandResult | undefined;
    try {
      const { token, ...rest } = prepared;
      void token;
      result = (await stub.runChecks({ ...rest, sessionId: sessionOf(input.repo) }))[0];
    } finally {
      await prepared.token();
    }
    let steps: ProofRecord["steps"];
    try {
      steps = (JSON.parse(result?.stdout ?? "") as { steps: ProofRecord["steps"] }).steps;
    } catch {
      steps = [{ name: flow, ok: false, detail: tail(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`, 10) || "the probe printed nothing" }];
    }
    return { feature: input.feature, flow, url: input.url, commitId: input.commitId, ok: result?.code === 0 && steps.length > 0 && steps.every((s) => s.ok), steps, at: Date.now() };
  }
}

const PROBE = `const [url, limit] = process.argv.slice(1);
let detail = "no answer";
let ok = false;
for (let attempt = 0; attempt < 3 && !ok; attempt++) {
  if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    ok = response.status < Number(limit);
    detail = \`\${url} answered \${response.status} \${response.statusText}\`.trim();
  } catch (error) {
    detail = \`\${url} did not answer: \${error instanceof Error ? error.message : String(error)}\`;
  }
}
process.stdout.write(JSON.stringify({ steps: [{ name: "GET " + new URL(url).pathname, ok, detail }] }));
process.exitCode = ok ? 0 : 1;`;
