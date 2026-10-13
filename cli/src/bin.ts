#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkTree, formatProblems, type CodeRule } from "@chef/core/checks";
import { lintSpecFiles, parseFeature, Router, readSpec, withSkills, type Deps, type ChefEvent } from "@chef/core";
import { KeywordClassifier, TemplatePlanner } from "@chef/core/fakes";
import { readTree } from "./fs.ts";
import { demoScript } from "./demo.ts";
import { localWorld, REPO_ROOT, repoProfiles, templateTree } from "./world.ts";
import { RunnerCoder } from "./local/runner-coder.ts";
import { report, runSpike, type SpikeDataset, type SpikeMode } from "./spike/jev.ts";
import { BENCH_ITEMS } from "./bench/items.ts";
import { runVoice, VOICE_PROMPT } from "./voice.ts";
import { exportTuneData } from "./tune/data.ts";
import { serve } from "./serve.ts";
import { fileStore, startApp } from "./app.ts";
import { Docker } from "./engine/docker.ts";
import { LocalEngine, localHome } from "./engine/engine.ts";
import { deploy } from "./deploy.ts";
import { spawn } from "node:child_process";
import { tour } from "./tour.ts";
import { renderReport, runBench, runReplay, type BenchMode, type BenchResult } from "./bench/run.ts";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positional(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] as string).startsWith("--")) {
      if (args[i + 1] !== undefined && !(args[i + 1] as string).startsWith("--")) i++;
      continue;
    }
    out.push(args[i] as string);
  }
  return out;
}

function specLint(dir: string): number {
  const files = readTree(resolve(dir), (p) => p.endsWith(".md"));
  const prefixed: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) prefixed[`spec/${path}`] = content;
  const { features, problems } = lintSpecFiles(prefixed);
  for (const p of problems) process.stderr.write(`${p.path}: ${p.message}\n`);
  process.stdout.write(`${features.length} features, ${problems.length} problems\n`);
  return problems.length === 0 ? 0 : 1;
}

function check(root: string, rules: CodeRule[]): number {
  const tree = readTree(resolve(root), (p) => /\.(?:[cm]?[jt]sx?)$/.test(p));
  const problems = checkTree(tree, rules);
  if (problems.length > 0) process.stderr.write(`${formatProblems(problems)}\n`);
  process.stdout.write(`${Object.keys(tree).length} files checked, ${problems.length} problems\n`);
  return problems.length === 0 ? 0 : 1;
}

async function route(prompt: string, specDir: string | undefined): Promise<number> {
  const tree = specDir ? readTree(resolve(specDir)) : {};
  const prefixed: Record<string, string> = {};
  for (const [path, content] of Object.entries(tree)) prefixed[path.startsWith("spec/") ? path : `spec/${path}`] = content;
  const spec = readSpec(prefixed);
  const classifier = process.env["TYPESAFE_API_KEY"] ? await (await import("@chef/adapters/jev")).JevClassifier.fromEnv() : new KeywordClassifier();
  const router = new Router({ classifier, planner: new TemplatePlanner() });
  process.stdout.write(`${JSON.stringify(await router.route(prompt, spec), null, 2)}\n`);
  return 0;
}

function describe(event: ChefEvent): string | null {
  switch (event.type) {
    case "route.decided":
      return `route  ${event.decision.intent} via ${event.decision.via} (${event.decision.confidence.toFixed(2)})`;
    case "session.created":
      return `session ${event.sessionId} fork ${event.fork}`;
    case "session.state":
      return `state  ${event.sessionId} ${event.from} -> ${event.to} (${event.reason})`;
    case "commit.created":
      return `commit ${event.commitId.slice(0, 10)} [${event.role}] ${event.message}`;
    case "preview.updated":
      return `preview ${event.url} @ ${event.commitId.slice(0, 10)}`;
    case "review.verdict":
      return `review ${event.approve ? "approved" : `rejected: ${event.reasons.join("; ")}`}`;
    case "gate.result":
      return [`gate   ${event.ok ? "passed" : "failed"}: ${event.checks.map((c) => `${c.name}=${c.ok ? "ok" : "FAIL"}`).join(" ")}`, ...event.checks.filter((c) => !c.ok).map((c) => `       ${c.name}: ${c.log.split("\n").slice(0, 6).join("\n       ")}`)].join("\n");
    case "main.merged":
      return `merged ${event.featureId} -> main`;
    case "session.stuck":
      return `stuck  ${event.featureId}: ${event.reason}`;
    default:
      return null;
  }
}

function promptOf(role: string): string {
  const profile = repoProfiles()[role];
  if (!profile) throw new Error(`agents/${role}.md is missing`);
  return withSkills(profile.instructions, profile.skills);
}

async function liveDeps(): Promise<Partial<Deps>> {
  const { llmFromProvider, providerBaseUrl, providerFromEnv } = await import("@chef/adapters/anthropic");
  const { LlmPlanner } = await import("@chef/adapters/llm-planner");
  const { LlmReviewer } = await import("@chef/adapters/llm-reviewer");
  const provider = providerFromEnv(process.env);
  if (!provider) throw new Error("--live needs ANTHROPIC_API_KEY, or LLM_BASE_URL and LLM_API_KEY for a custom provider");
  const llm = llmFromProvider(provider);
  const baseUrl = providerBaseUrl(provider);
  const apiKey = provider.apiKey;
  const classifier = process.env["TYPESAFE_API_KEY"] ? (await import("@chef/adapters/jev")).JevClassifier.fromEnv() : new KeywordClassifier();
  return {
    classifier,
    planner: new LlmPlanner(llm, process.env["PLANNER_MODEL"] ?? "claude-opus-5-5", promptOf("planner")),
    reviewer: new LlmReviewer(llm, process.env["REVIEWER_MODEL"] ?? "claude-opus-5-5", promptOf("reviewer")),
    coder: new RunnerCoder({ runner: join(REPO_ROOT, "workers", "sandbox", "runner.mjs"), baseUrl, apiKey, model: process.env["CODER_MODEL"] ?? "claude-sonnet-5-5", nodeModules: join(REPO_ROOT, "template", "node_modules"), lint: join(REPO_ROOT, "workers", "sandbox", "lint.mjs") }),
  };
}

async function demo(args: readonly string[]): Promise<number> {
  const prompt = positional(args)[1] ?? "Add an item to a todo list";
  const real = !args.includes("--fake-checks");
  if (args.includes("--live")) {
    const w = localWorld({ script: () => ({ changes: {} }), real, deps: await liveDeps() });
    w.bus.subscribe((event) => {
      const line = describe(event);
      if (line) process.stdout.write(`${line}\n`);
    });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    if (!sessionId) return 1;
    const record = await w.orchestrator.run(sessionId);
    process.stdout.write(`\n${record.featureId}: ${record.machine.state} after ${record.machine.usage.attempts} attempt(s), ${record.commits.length} commits\n`);
    return record.machine.state === "merged" ? 0 : 1;
  }
  const fixture = readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo"));
  const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!spec.ok) throw new Error(spec.errors.join("\n"));
  const w = localWorld({ script: demoScript(fixture), presets: new Map([[prompt, spec.spec]]), real });
  w.bus.subscribe((event) => {
    const line = describe(event);
    if (line) process.stdout.write(`${line}\n`);
  });
  await w.orchestrator.bootstrap(templateTree());
  const { sessionId } = await w.orchestrator.submit(prompt);
  if (!sessionId) return 1;
  const record = await w.orchestrator.run(sessionId);
  process.stdout.write(`\n${record.featureId}: ${record.machine.state} after ${record.machine.usage.attempts} attempt(s), ${record.commits.length} commits\n`);
  return record.machine.state === "merged" ? 0 : 1;
}

async function spikeJev(args: readonly string[]): Promise<number> {
  const dataset = JSON.parse(readFileSync(resolve(option(args, "data") ?? join(REPO_ROOT, "docs", "spikes", "jev-routing", "prompts.json")), "utf8")) as SpikeDataset;
  const mode = option(args, "mode") ?? "both";
  const modes: SpikeMode[] = mode === "both" ? ["raw", "translated"] : [mode as SpikeMode];
  const classifier = process.env["TYPESAFE_API_KEY"] ? (await import("@chef/adapters/jev")).JevClassifier.fromEnv() : new KeywordClassifier();
  let done = 0;
  const results = await runSpike(classifier, dataset, modes, undefined, () => {
    done++;
    if (done % 20 === 0) process.stderr.write(`${done} prompts routed\n`);
  });
  const text = report(classifier.model, results);
  const out = option(args, "out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), text);
    writeFileSync(resolve(out).replace(/\.md$/, ".json"), `${JSON.stringify(results, null, 1)}\n`);
  }
  process.stdout.write(text);
  return 0;
}

async function bench(args: readonly string[]): Promise<number> {
  const mode = option(args, "mode") ?? "both";
  const modes: BenchMode[] = mode === "both" ? ["phase2", "phase3"] : [mode as BenchMode];
  const only = option(args, "only")?.split(",");
  const items = only ? BENCH_ITEMS.filter((item) => only.includes(item.id)) : BENCH_ITEMS;
  const concurrency = Number(option(args, "concurrency") ?? 3);
  const results: BenchResult[] = [];
  if (mode === "replay") {
    process.stderr.write(`learning on ${items.length} features, then replaying them in a new project seeded with the learned memory\n`);
    results.push(...(await runReplay(items, { concurrency })));
  } else {
    for (const m of modes) {
      process.stderr.write(`running ${items.length} features with ${m} settings\n`);
      results.push(await runBench(m, items, { concurrency }));
    }
  }
  const text = renderReport(results);
  const out = option(args, "out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), text);
    writeFileSync(resolve(out).replace(/\.md$/, ".json"), `${JSON.stringify(results, null, 1)}\n`);
  }
  process.stdout.write(text);
  return 0;
}

async function voice(args: readonly string[]): Promise<number> {
  const run = await runVoice({ say: option(args, "say") ?? VOICE_PROMPT, live: args.includes("--live"), real: !args.includes("--fake-checks"), log: (line) => process.stderr.write(`${line}\n`) });
  const text = `${JSON.stringify(run, null, 2)}\n`;
  const out = option(args, "out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), text);
  }
  process.stdout.write(text);
  return run.state === "merged" ? 0 : 1;
}

async function tuneData(args: readonly string[]): Promise<number> {
  const summary = await exportTuneData(resolve(option(args, "out") ?? join(REPO_ROOT, "tune", "data")), { concurrency: Number(option(args, "concurrency") ?? 3), log: (line) => process.stderr.write(`${line}\n`) });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

async function llmCheck(args: readonly string[]): Promise<number> {
  const prompt = positional(args)[2] ?? "Add an item to a todo list";
  const { llmFromEnv } = await import("@chef/adapters/anthropic");
  const { LlmPlanner } = await import("@chef/adapters/llm-planner");
  const { LlmReviewer } = await import("@chef/adapters/llm-reviewer");
  const llm = llmFromEnv(process.env);
  const model = option(args, "model") ?? process.env["PLANNER_MODEL"] ?? "claude-opus-5-5";
  const planner = new LlmPlanner(llm, model, promptOf("planner"));
  const started = Date.now();
  const triage = await planner.triage({ prompt, spec: [] });
  process.stdout.write(`triage via ${llm.via} ${model}: ${triage.intent} (${triage.confidence.toFixed(2)}) ${triage.reason}\n`);
  const plan = await planner.plan({ prompt, spec: [], intent: "new_feature", featureId: null, changeKind: null });
  process.stdout.write(`plan: ${plan.feature.id} with ${plan.feature.acceptance.length} acceptance criteria and ${plan.items.length} work items\n`);
  const fixture = readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo"));
  const spec = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!spec.ok) throw new Error(spec.errors.join("\n"));
  const verdict = await new LlmReviewer(llm, option(args, "model") ?? process.env["REVIEWER_MODEL"] ?? model, promptOf("reviewer")).review({ feature: spec.spec, diff: fixture, checksLog: "" });
  process.stdout.write(`review of the todo fixture: ${verdict.approve ? "approved" : `rejected: ${verdict.reasons.join("; ")}`}\n`);
  process.stdout.write(`done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  return 0;
}

async function serveCommand(args: readonly string[]): Promise<number> {
  const project = option(args, "project");
  const attempts = Number(option(args, "attempts") ?? 1);
  const local = await serve({ port: Number(option(args, "port") ?? 8787), ...(project ? { project } : {}), ...(attempts > 1 ? { attempts } : {}), real: !args.includes("--fake-checks"), log: (line) => process.stderr.write(`${line}\n`) });
  process.stdout.write(`chef is serving ${local.url}/\n`);
  await new Promise<void>((resolve) => process.once("SIGINT", resolve));
  await local.close();
  return 0;
}

async function appCommand(args: readonly string[]): Promise<number> {
  const local = args.includes("--local");
  const docker = new Docker({ repos: join(localHome(), "repos") });
  const app = await startApp({
    port: Number(option(args, "port") ?? process.env["PORT"] ?? 4300),
    store: fileStore(undefined, process.env, local ? { place: "computer" } : null),
    dockerProblem: () => docker.available(),
    startEngine: async (log) => {
      const engine = await LocalEngine.start({
        log: (line) => {
          log(line);
          process.stderr.write(`${line}\n`);
        },
      });
      process.stderr.write(`chef is running on this computer. Data is in ${engine.dir}.\n`);
      return engine;
    },
  });
  process.stdout.write(`chef is open at ${app.url}\nPress Ctrl+C to stop.\n`);
  if (!args.includes("--no-open") && !process.env["CI"]) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    spawn(opener, [app.url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  }
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await app.close();
  return 0;
}

async function deployCommand(args: readonly string[]): Promise<number> {
  const name = option(args, "name");
  const passthrough: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "deploy" || arg === "--dry-run" || arg === "--") continue;
    if (arg === "--name") {
      i++;
      continue;
    }
    passthrough.push(arg);
  }
  const result = await deploy({ ...(name ? { name } : {}), dryRun: args.includes("--dry-run"), passthrough });
  return result.code;
}

async function tourCommand(args: readonly string[]): Promise<number> {
  const url = option(args, "url") ?? process.env["CHEF_URL"];
  if (!url) {
    process.stderr.write("chef tour needs --url or CHEF_URL\n");
    return 2;
  }
  const result = await tour({
    url,
    password: process.env["CHEF_PASSWORD"],
    project: option(args, "project"),
    prompt: option(args, "prompt"),
    minutes: Number(option(args, "minutes") ?? 20),
    everySeconds: Number(option(args, "every") ?? 45),
    out: resolve(option(args, "out") ?? "results/tour"),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify({ ...result, shots: result.shots.length }, null, 2)}\n`);
  return result.errors.length ? 1 : 0;
}

async function main(args: readonly string[]): Promise<number> {
  const [command, sub] = args;
  if (command === "spec" && sub === "lint") return specLint(positional(args)[2] ?? "spec");
  if (command === "check") {
    const rules = (option(args, "rules") ?? "no-comments,import-boundaries").split(",") as CodeRule[];
    return check(option(args, "root") ?? ".", rules);
  }
  if (command === "route" && sub) return route(positional(args)[1] as string, option(args, "spec"));
  if (command === "demo") return demo(args);
  if (command === "spike" && sub === "jev") return spikeJev(args);
  if (command === "llm" && sub === "check") return llmCheck(args);
  if (command === "bench") return bench(args);
  if (command === "voice") return voice(args);
  if (command === "tune" && sub === "data") return tuneData(args);
  if (command === "serve") return serveCommand(args);
  if (command === "tour") return tourCommand(args);
  if (command === "app") return appCommand(args);
  if (command === "deploy") return deployCommand(args);
  process.stderr.write("usage: chef spec lint [dir] | chef check [--root dir] [--rules a,b] | chef route <prompt> [--spec dir] | chef demo [prompt] [--fake-checks] [--live] | chef spike jev [--mode raw|translated|both] [--data file] [--out file.md] | chef llm check [prompt] [--model id] | chef bench [--mode phase2|phase3|phase4|replay|both] [--only a,b] [--out file.md] | chef voice [--say text] [--live] | chef tune data [--out dir] | chef serve [--port n] [--project id] [--attempts n] [--fake-checks] | chef app [--local] [--port n] [--no-open] | chef deploy [--name n] [--dry-run] [wrangler args] | chef tour --url u [--project id] [--prompt text] [--minutes n] [--every s] [--out dir]\n");
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
