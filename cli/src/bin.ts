#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkTree, formatProblems, type CodeRule } from "@kargah/core/checks";
import { lintSpecFiles, parseFeature, Router, readSpec, type KargahEvent } from "@kargah/core";
import { KeywordClassifier, TemplatePlanner } from "@kargah/core/fakes";
import { readTree } from "./fs.ts";
import { demoScript } from "./demo.ts";
import { localWorld, REPO_ROOT, templateTree } from "./world.ts";

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
  const classifier = process.env["TYPESAFE_API_KEY"] ? await (await import("@kargah/adapters/jev")).JevClassifier.fromEnv() : new KeywordClassifier();
  const router = new Router({ classifier, planner: new TemplatePlanner() });
  process.stdout.write(`${JSON.stringify(await router.route(prompt, spec), null, 2)}\n`);
  return 0;
}

function describe(event: KargahEvent): string | null {
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
      return `gate   ${event.ok ? "passed" : "failed"}: ${event.checks.map((c) => `${c.name}=${c.ok ? "ok" : "FAIL"}`).join(" ")}`;
    case "main.merged":
      return `merged ${event.featureId} -> main`;
    case "session.stuck":
      return `stuck  ${event.featureId}: ${event.reason}`;
    default:
      return null;
  }
}

async function demo(args: readonly string[]): Promise<number> {
  const prompt = positional(args)[1] ?? "Add an item to a todo list";
  const real = !args.includes("--fake-checks");
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

async function main(args: readonly string[]): Promise<number> {
  const [command, sub] = args;
  if (command === "spec" && sub === "lint") return specLint(positional(args)[2] ?? "spec");
  if (command === "check") {
    const rules = (option(args, "rules") ?? "no-comments,import-boundaries").split(",") as CodeRule[];
    return check(option(args, "root") ?? ".", rules);
  }
  if (command === "route" && sub) return route(positional(args)[1] as string, option(args, "spec"));
  if (command === "demo") return demo(args);
  process.stderr.write("usage: kargah spec lint [dir] | kargah check [--root dir] [--rules a,b] | kargah route <prompt> [--spec dir] | kargah demo [prompt] [--fake-checks]\n");
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
