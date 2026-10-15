import { checkTree, formatProblems } from "../checks/code-rules.ts";
import type { Tree } from "../git/tree.ts";
import type { CheckResult, CheckRunner, ProbeInput, ProofRecord, ProofRunner } from "../ports/check-runner.ts";
import { usesChefTemplate } from "../structure/structure.ts";
import type { Clock } from "../ports/runtime.ts";
import { lintSpecFiles } from "../spec/lint.ts";

export type TestOracle = (tree: Tree) => { ok: boolean; log: string };

export const testsExistOracle: TestOracle = (tree) => {
  const problems: string[] = [];
  const features = new Set<string>();
  for (const path of Object.keys(tree)) {
    const match = /^features\/([^/]+)\//.exec(path);
    if (match) features.add(match[1] as string);
  }
  for (const feature of features) {
    const files = Object.keys(tree).filter((p) => p.startsWith(`features/${feature}/`));
    if (!files.some((p) => p.endsWith(".test.ts"))) problems.push(`features/${feature} has no tests`);
    if (!files.includes(`features/${feature}/index.ts`)) problems.push(`features/${feature} has no index.ts`);
  }
  for (const [path, content] of Object.entries(tree)) if (content.includes("<<<<<<<")) problems.push(`${path} has conflict markers`);
  return { ok: problems.length === 0, log: problems.join("\n") || `${features.size} features have tests` };
};

export class FakeCheckRunner implements CheckRunner {
  readonly runs: { repo: string; commitId: string }[] = [];
  private readonly injected: { name: string; log: string; times: number; repo: string | null }[] = [];

  constructor(
    private readonly oracle: TestOracle = testsExistOracle,
    private readonly generated: Readonly<Record<string, (tree: Tree) => string>> = {},
  ) {}

  failNext(name: string, log: string, times = 1, repo: string | null = null): void {
    this.injected.push({ name, log, times, repo });
  }

  async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
    this.runs.push({ repo: input.repo, commitId: input.commitId });
    const template = usesChefTemplate(input.tree);
    const code = template ? checkTree(input.tree) : [];
    const specFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(input.tree)) if (path.startsWith("spec/")) specFiles[path] = content;
    const spec = lintSpecFiles(specFiles).problems;
    const stale = template ? Object.entries(this.generated).filter(([path, generate]) => input.tree[path] !== generate(input.tree)).map(([path]) => path) : [];
    const tests = this.oracle(input.tree);
    const results: CheckResult[] = [
      ...(template ? [{ name: "lint", ok: code.length === 0, log: formatProblems(code) || "no problems" }] : []),
      { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" },
      ...(template ? [{ name: "generated", ok: stale.length === 0, log: stale.length ? `stale: ${stale.join(", ")}` : "generated files up to date" }] : []),
      { name: "test", ok: tests.ok, log: tests.log },
    ];
    return results.map((result) => {
      const injected = this.injected.find((i) => i.name === result.name && i.times > 0 && (i.repo === null || i.repo === input.repo));
      if (!injected) return result;
      injected.times--;
      return { name: result.name, ok: false, log: injected.log };
    });
  }
}

export class FakeProofRunner implements ProofRunner {
  readonly proofs: ProofRecord[] = [];
  private readonly injected: { feature: string; detail: string; times: number; repo: string | null }[] = [];

  constructor(private readonly clock: Clock) {}

  failNext(feature: string, detail: string, times = 1, repo: string | null = null): void {
    this.injected.push({ feature, detail, times, repo });
  }

  async prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord> {
    const flowPath = `features/${input.flow}/flow.ts`;
    const flow = input.tree[flowPath];
    const steps = flow
      ? [...flow.matchAll(/name:\s*"([^"]+)"/g)].map((m) => ({ name: m[1] as string, ok: true, detail: `fake drive of ${input.url}` }))
      : [{ name: "load flow", ok: false, detail: `${flowPath} does not exist` }];
    const injected = this.injected.find((i) => i.feature === input.feature && i.times > 0 && (i.repo === null || i.repo === input.repo));
    if (injected) {
      injected.times--;
      steps.push({ name: "drive", ok: false, detail: injected.detail });
    }
    const proof: ProofRecord = { feature: input.feature, flow: input.flow, url: input.url, commitId: input.commitId, ok: steps.length > 0 && steps.every((s) => s.ok), steps, at: this.clock.now() };
    this.proofs.push(proof);
    return proof;
  }

  async probe(input: ProbeInput): Promise<ProofRecord> {
    const proof: ProofRecord = { feature: input.feature, flow: `GET ${input.path}`, url: input.url, commitId: input.commitId, ok: true, steps: [{ name: `GET ${input.path}`, ok: true, detail: `fake request to ${input.url}` }], at: this.clock.now() };
    this.proofs.push(proof);
    return proof;
  }
}
