import { join } from "node:path";
import { checkTree, formatProblems, parseTap } from "@chef/core/checks";
import { lintSpecFiles, repoChecks, usesChefTemplate, type CheckResult, type CheckRunner, type Clock, type ProbeInput, type ProofRecord, type ProofRunner, type Tree } from "@chef/core";
import { exec } from "./exec.ts";
import { materialize } from "./materialize.ts";

const NODE_TS = ["--experimental-strip-types", "--no-warnings"];

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

function failures(tap: string): string {
  const lines = tap.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*not ok \d+ - /.test(line)) out.push(line.trim(), ...lines.slice(i + 1, i + 12).filter((l) => /error:|expected|actual|message/i.test(l)).map((l) => l.trim()));
  });
  return out.join("\n");
}

export class LocalCheckRunner implements CheckRunner {
  constructor(private readonly nodeModules: string) {}

  async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
    if (!usesChefTemplate(input.tree)) return this.runOwn(input.tree);
    const work = await materialize(input.tree, this.nodeModules);
    try {
      const tsc = join(this.nodeModules, "typescript", "bin", "tsc");
      const [typecheck, tests, generated] = await Promise.all([
        exec(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: work.dir }),
        exec(process.execPath, ["--test", "--test-reporter=tap", ...NODE_TS, "features/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"], { cwd: work.dir }),
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
        { name: "test", ok: tests.code === 0, log: tail(failures(tests.stdout) || tests.stdout + tests.stderr), cases: parseTap(tests.stdout) },
      ];
    } finally {
      await work.dispose();
    }
  }

  private async runOwn(tree: Tree): Promise<CheckResult[]> {
    const own = repoChecks(tree);
    const results: CheckResult[] = [];
    if (own.install) {
      const work = await materialize(tree, null);
      try {
        for (const command of [own.install, ...own.commands]) {
          if (results.some((r) => !r.ok && r.name === "install")) {
            results.push({ name: command.name, ok: false, log: "Not run: installing the dependencies failed." });
            continue;
          }
          const run = await exec(command.argv[0] as string, command.argv.slice(1), { cwd: work.dir, timeoutMs: command.timeoutMs ?? 300_000, env: { ...command.env } });
          results.push({ name: command.name, ok: run.code === 0, log: tail(run.stdout + run.stderr, 60) || `${command.name} ok` });
        }
      } finally {
        await work.dispose();
      }
    }
    const specFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(tree)) if (path.startsWith("spec/")) specFiles[path] = content;
    const spec = lintSpecFiles(specFiles).problems;
    return [...results, ...own.notes, { name: "spec-lint", ok: spec.length === 0, log: spec.map((p) => `${p.path}: ${p.message}`).join("\n") || "spec ok" }];
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

  async probe(input: ProbeInput): Promise<ProofRecord> {
    const flow = `GET ${input.path}`;
    const target = new URL(input.path, input.url).href;
    const done = (ok: boolean, detail: string): ProofRecord => ({ feature: input.feature, flow, url: input.url, commitId: input.commitId, ok, steps: [{ name: flow, ok, detail }], at: this.clock.now() });
    if (!this.reachable(input.url)) return done(true, `${target} cannot be reached from this computer, so there is nothing to ask`);
    try {
      const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      return done(response.status < (input.path === "/" ? 500 : 400), `${target} answered ${response.status}`);
    } catch (error) {
      return done(false, `${target} did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
