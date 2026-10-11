import { join } from "node:path";
import { checkTree, formatProblems } from "@kargah/core/checks";
import { lintSpecFiles, type CheckResult, type CheckRunner, type Clock, type ProofRecord, type ProofRunner, type Tree } from "@kargah/core";
import { exec } from "./exec.ts";
import { materialize } from "./materialize.ts";

const NODE_TS = ["--experimental-strip-types", "--no-warnings"];

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

export class LocalCheckRunner implements CheckRunner {
  constructor(private readonly nodeModules: string) {}

  async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
    const work = await materialize(input.tree, this.nodeModules);
    try {
      const tsc = join(this.nodeModules, "typescript", "bin", "tsc");
      const [typecheck, tests, generated] = await Promise.all([
        exec(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: work.dir }),
        exec(process.execPath, ["--test", ...NODE_TS, "features/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"], { cwd: work.dir }),
        exec(process.execPath, [...NODE_TS, "app/cli.ts", "gen", "--check"], { cwd: work.dir }),
      ]);
      const code = checkTree(input.tree);
      const specFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(input.tree)) if (path.startsWith("spec/")) specFiles[path] = content;
      const spec = lintSpecFiles(specFiles).problems;
      return [
        { name: "typecheck", ok: typecheck.code === 0, log: tail(typecheck.stdout + typecheck.stderr) || "tsc ok" },
        { name: "lint", ok: code.length === 0, log: formatProblems(code) || "no problems" },
        { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" },
        { name: "generated", ok: generated.code === 0, log: tail(generated.stderr) || "generated files up to date" },
        { name: "test", ok: tests.code === 0, log: tail(tests.stdout + tests.stderr) },
      ];
    } finally {
      await work.dispose();
    }
  }
}

export class LocalProofRunner implements ProofRunner {
  constructor(
    private readonly nodeModules: string,
    private readonly clock: Clock,
    private readonly reachable: (url: string) => boolean = (url) => !/\.example(?:\/|$)/.test(new URL(url).hostname + "/"),
  ) {}

  async prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord> {
    const work = await materialize(input.tree, this.nodeModules);
    try {
      const args = [...NODE_TS, "app/cli.ts", "proof", input.feature, "--commit", input.commitId];
      if (this.reachable(input.url)) args.push("--url", input.url);
      const result = await exec(process.execPath, args, { cwd: work.dir });
      let parsed: { ok?: boolean; url?: string; steps?: { name: string; ok: boolean; detail: string }[] } = {};
      try {
        parsed = JSON.parse(result.stdout) as typeof parsed;
      } catch {
        parsed = { ok: false, steps: [{ name: "run proof", ok: false, detail: tail(result.stderr || result.stdout, 10) }] };
      }
      return {
        feature: input.feature,
        flow: input.flow,
        url: parsed.url ?? input.url,
        commitId: input.commitId,
        ok: result.code === 0 && parsed.ok === true,
        steps: parsed.steps ?? [],
        at: this.clock.now(),
      };
    } finally {
      await work.dispose();
    }
  }
}
