import { join } from "node:path";
import { exportOutcomes, featureMapProblems, MEMORY_DIR, type CheckResult, type CheckRunner, type ChefEvent, type ProofRecord, type ProofRunner, type ReviewExample, type Tree, type TurnExample } from "@chef/core";
import { parseTap, RULES_DIR } from "@chef/core/checks";
import { exec } from "../local/exec.ts";
import { materialize } from "../local/materialize.ts";
import { LocalCheckRunner, LocalProofRunner } from "../local/runners.ts";
import { localWorld, REPO_ROOT, stub, templateTree } from "../world.ts";
import { benchScript, testStyle } from "./agent.ts";
import { monitor, promptFor, specFor, tests, type BenchItem, type Fault } from "./items.ts";

export type BenchMode = "phase2" | "phase3" | "phase4" | "replay";

export interface ItemResult {
  readonly id: string;
  readonly fault: Fault;
  readonly state: string;
  readonly merges: number;
  readonly reverts: number;
  readonly sessions: number;
  readonly rejected: Readonly<Record<string, number>>;
  readonly picked: string | null;
  readonly stuckReason: string | null;
}

export interface MemoryStats {
  readonly lessons: readonly string[];
  readonly rulesAdded: readonly { readonly id: string; readonly message: string }[];
  readonly rulesOnMain: readonly string[];
  readonly lessonRecalls: number;
  readonly featureMapFailures: number;
  readonly mainCommits: number;
}

export interface BenchResult {
  readonly mode: BenchMode;
  readonly memory: MemoryStats;
  readonly items: readonly ItemResult[];
  readonly merges: number;
  readonly reverts: number;
  readonly revertRate: number;
  readonly mergedFeatures: number;
  readonly stuck: number;
  readonly violationsOnMain: readonly string[];
  readonly events: number;
  readonly checkRuns: number;
  readonly seconds: number;
}

class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class MonitoredChecks implements CheckRunner {
  runs = 0;

  constructor(
    private readonly inner: CheckRunner,
    private readonly canonical: string,
    private readonly items: readonly BenchItem[],
    private readonly nodeModules: string,
    private readonly limiter: Limiter,
  ) {}

  async run(input: { repo: string; commitId: string; tree: Tree; features?: readonly string[] }): Promise<CheckResult[]> {
    this.runs++;
    const results = await this.limiter.run(() => this.inner.run(input));
    if (input.repo !== this.canonical) return results;
    return [...results, await this.limiter.run(() => this.monitor(input.tree))];
  }

  private async monitor(tree: Tree): Promise<CheckResult> {
    const live = this.items.filter((item) => tree[`features/${item.id}/index.ts`] !== undefined);
    if (live.length === 0) return { name: "monitor", ok: true, log: "no bench features on main" };
    const files: Record<string, string> = { ...tree };
    for (const item of live) files[`monitor/${item.id}.test.ts`] = monitor(item);
    const work = await materialize(files, this.nodeModules);
    try {
      const run = await exec(process.execPath, ["--test", "--test-reporter=tap", "--experimental-strip-types", "--no-warnings", "monitor/*.test.ts"], { cwd: work.dir });
      const failed = parseTap(run.stdout).filter((c) => !c.ok && c.name.startsWith("monitor "));
      return { name: "monitor", ok: run.code === 0, log: failed.map((c) => `not ok ${c.name}`).join("\n") || (run.code === 0 ? `${live.length} features answer correctly` : run.stderr.slice(-2000)) };
    } finally {
      await work.dispose();
    }
  }
}

class LimitedProofs implements ProofRunner {
  constructor(
    private readonly inner: ProofRunner,
    private readonly limiter: Limiter,
  ) {}

  prove(input: Parameters<ProofRunner["prove"]>[0]): Promise<ProofRecord> {
    return this.limiter.run(() => this.inner.prove(input));
  }
}

const SPECIALIZATION: Record<BenchMode, { attempts: number; lockTests: boolean; stub: typeof stub | null }> = {
  phase2: { attempts: 1, lockTests: false, stub: null },
  phase3: { attempts: 2, lockTests: true, stub },
  phase4: { attempts: 1, lockTests: true, stub },
  replay: { attempts: 1, lockTests: true, stub },
};

export interface BenchOptions {
  readonly concurrency?: number;
  readonly seed?: Tree;
}

export async function runBench(mode: BenchMode, items: readonly BenchItem[], options: BenchOptions = {}): Promise<BenchResult> {
  return (await runOnce(mode, items, options)).result;
}

export async function runReplay(items: readonly BenchItem[], options: BenchOptions = {}): Promise<[BenchResult, BenchResult]> {
  const learning = await runOnce("phase4", items, options);
  const replay = await runOnce("replay", items, { ...options, seed: learning.learned });
  return [learning.result, replay.result];
}

export async function runForOutcomes(items: readonly BenchItem[], options: BenchOptions = {}): Promise<{ result: BenchResult; reviews: ReviewExample[]; turns: TurnExample[] }> {
  const run = await runOnce("phase4", items, options);
  const outcomes = await exportOutcomes({ log: run.world.bus.log, repos: run.world.repos, canonical: run.world.orchestrator.canonical, sessions: await run.world.orchestrator.sessions() });
  return { result: run.result, ...outcomes };
}

async function runOnce(mode: BenchMode, items: readonly BenchItem[], options: BenchOptions): Promise<{ result: BenchResult; learned: Tree; world: ReturnType<typeof localWorld> }> {
  const started = Date.now();
  const nodeModules = join(REPO_ROOT, "template", "node_modules");
  const limiter = new Limiter(options.concurrency ?? 3);
  const checks = new MonitoredChecks(new LocalCheckRunner(nodeModules), "demo", items, nodeModules, limiter);
  const presets = new Map(items.map((item) => [promptFor(item), specFor(item)]));
  const specialization = SPECIALIZATION[mode];
  const proofs = new LimitedProofs(new LocalProofRunner(nodeModules, { now: () => Date.now() }), limiter);
  const w = localWorld({ script: benchScript(items), presets, real: true, config: { specialization }, deps: { checks, proofs, clock: { now: () => Date.now() } } });
  await w.orchestrator.bootstrap({ ...templateTree(), ...(options.seed ?? {}) });
  for (const item of items) await w.orchestrator.submit(promptFor(item));
  const sessions = await w.orchestrator.drain(400);
  const log = w.bus.log;
  const results = items.map((item): ItemResult => {
    const own = sessions.filter((s) => s.featureId === item.id);
    const rejected: Record<string, number> = {};
    for (const e of log) if (e.type === "turn.rejected" && e.featureId === item.id) rejected[e.rule] = (rejected[e.rule] ?? 0) + 1;
    const picked = log.find((e) => e.type === "attempt.picked" && e.featureId === item.id);
    const live = own.find((s) => s.machine.state !== "dropped") ?? own[0];
    const stuck = log.findLast((e) => e.type === "session.stuck" && e.featureId === item.id);
    return {
      id: item.id,
      fault: item.fault,
      state: live?.machine.state ?? "missing",
      merges: count(log, "main.merged", item.id),
      reverts: count(log, "main.reverted", item.id),
      sessions: own.length,
      rejected,
      picked: picked?.type === "attempt.picked" ? `attempt ${own.find((s) => s.id === picked.winner)?.attempt.index ?? "?"}` : null,
      stuckReason: stuck?.type === "session.stuck" ? stuck.reason : null,
    };
  });
  const merges = results.reduce((n, r) => n + r.merges, 0);
  const reverts = results.reduce((n, r) => n + r.reverts, 0);
  const main = await w.orchestrator.mainTree();
  const learned = Object.fromEntries(Object.entries(main.tree).filter(([path]) => path.startsWith(MEMORY_DIR) || path.startsWith(RULES_DIR)));
  const result: BenchResult = {
    mode,
    memory: await memoryStats(w, log),
    items: results,
    merges,
    reverts,
    revertRate: merges === 0 ? 0 : reverts / merges,
    mergedFeatures: results.filter((r) => r.state === "merged").length,
    stuck: results.filter((r) => r.state === "stuck").length,
    violationsOnMain: await violations(w.orchestrator.canonical, w.repos, items),
    events: log.length,
    checkRuns: checks.runs,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  return { result, learned, world: w };
}

async function memoryStats(w: ReturnType<typeof localWorld>, log: readonly ChefEvent[]): Promise<MemoryStats> {
  const history = await w.repos.log(w.orchestrator.canonical, "main", 1000);
  let featureMapFailures = 0;
  for (const commit of history) {
    const tree = (await w.repos.readCommit(w.orchestrator.canonical, commit.id))?.tree ?? {};
    if (featureMapProblems(tree).length > 0) featureMapFailures++;
  }
  const { tree } = await w.orchestrator.mainTree();
  return {
    lessons: log.flatMap((e) => (e.type === "memory.recorded" && e.kind === "lesson" ? [e.path] : [])),
    rulesAdded: [...new Map(log.flatMap((e) => (e.type === "lint.rule.added" ? [[e.ruleId, { id: e.ruleId, message: e.message }] as const] : []))).values()],
    rulesOnMain: Object.keys(tree).filter((path) => path.startsWith(RULES_DIR)),
    lessonRecalls: log.filter((e) => e.type === "memory.recalled" && e.paths.some((p) => p.startsWith(`${MEMORY_DIR}lessons/${e.featureId}-`))).length,
    featureMapFailures,
    mainCommits: history.length,
  };
}

function count(log: readonly ChefEvent[], type: "main.merged" | "main.reverted", featureId: string): number {
  return log.filter((e) => e.type === type && e.featureId === featureId).length;
}

async function violations(canonical: string, repos: ReturnType<typeof localWorld>["repos"], items: readonly BenchItem[]): Promise<string[]> {
  const head = await repos.resolveRef(canonical, "main");
  const tree = head ? ((await repos.readCommit(canonical, head))?.tree ?? {}) : {};
  const out: string[] = [];
  for (const item of items) {
    const path = `features/${item.id}/${item.id}.test.ts`;
    const onMain = tree[path];
    if (onMain === undefined) continue;
    const written = [tests(item, "good"), tests(item, "weak"), tests(item, testStyle(item, 1, false))];
    if (!written.includes(onMain)) out.push(`${path} on main is not a file the test agent wrote`);
  }
  return out;
}

export function renderReport(results: readonly BenchResult[]): string {
  const lines: string[] = [];
  lines.push("| Mode | Merged features | Merges | Reverts | Revert rate | Stuck | Test or scope violations on main | Check runs | Events | Seconds |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) lines.push(`| ${r.mode} | ${r.mergedFeatures}/${r.items.length} | ${r.merges} | ${r.reverts} | ${(r.revertRate * 100).toFixed(1)}% | ${r.stuck} | ${r.violationsOnMain.length} | ${r.checkRuns} | ${r.events} | ${r.seconds} |`);
  if (results.some((r) => r.mode === "phase4" || r.mode === "replay")) {
    lines.push("", "| Mode | Lessons written | Own-feature lesson recalls | Lint rules added | Lint rules on main | Main commits | Main commits where the feature map disagrees with the code |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const r of results) lines.push(`| ${r.mode} | ${r.memory.lessons.length} | ${r.memory.lessonRecalls} | ${r.memory.rulesAdded.length} | ${r.memory.rulesOnMain.length} | ${r.memory.mainCommits} | ${r.memory.featureMapFailures} |`);
  }
  for (const r of results) for (const rule of r.memory.rulesAdded) lines.push("", `Rule added in ${r.mode}: \`${rule.id}\`: ${rule.message}`);
  for (const r of results) {
    lines.push("", `### ${r.mode}`, "", "| Feature | Injected mistake | Final state | Sessions | Merges | Reverts | Rejected turns | Pick |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const item of r.items) {
      const rejected = Object.entries(item.rejected).map(([rule, n]) => `${rule} ${n}`).join(", ") || "none";
      lines.push(`| ${item.id} | ${item.fault} | ${item.state} | ${item.sessions} | ${item.merges} | ${item.reverts} | ${rejected} | ${item.picked ?? "n/a"} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
