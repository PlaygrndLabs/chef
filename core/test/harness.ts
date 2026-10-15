import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderRegistry } from "../../template/app/gen.ts";
import type { Tree } from "../src/git/tree.ts";
import { Orchestrator, type Deps, type ProjectConfig } from "../src/orchestrator/orchestrator.ts";
import { loadProfiles } from "../src/profiles/profile.ts";
import type { FeatureSpec } from "../src/spec/schema.ts";
import type { SplitPart } from "../src/ports/planner.ts";
import {
  FakeCheckRunner,
  FakeProofRunner,
  KeywordClassifier,
  LexicalIndex,
  MemoryEventBus,
  MemoryAppHost,
  MemoryRepoHost,
  MemoryStore,
  RuleReviewer,
  ScriptedCoder,
  SequentialIds,
  TemplatePlanner,
  TickingClock,
  type Script,
} from "../src/fakes/index.ts";

export const ROOT = join(import.meta.dirname, "..", "..");

export function readTree(dir: string, prefix = ""): Tree {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[`${prefix}${relative(dir, full).split("\\").join("/")}`] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

export const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

export function templateTree(): Tree {
  return readTree(join(ROOT, "template"));
}

export function fixture(name: string): Tree {
  return readTree(join(ROOT, "core", "test", "fixtures", name));
}

export function profiles() {
  return loadProfiles(readTree(join(ROOT, "agents")));
}

export const todoSpec: FeatureSpec = {
  id: "todo-add",
  title: "Add an item to a todo list",
  status: "building",
  entrypoint: "POST /todos",
  revision: 1,
  shared: [],
  env: [],
  acceptance: [
    { id: "AC1", text: "POST /todos adds an item and returns it" },
    { id: "AC2", text: "GET /todos lists added items in order" },
    { id: "AC3", text: "an empty item is rejected" },
  ],
  body: "A user adds an item to their todo list and sees it in the list.",
};

export function scriptFromFixture(files: Tree): Script {
  return (input) => {
    const prefix = `features/${input.featureId}/`;
    const changes: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const isTest = path.endsWith(".test.ts") || path.endsWith("/flow.ts");
      if (input.role === "test" ? isTest : !isTest) changes[path] = content;
    }
    return { changes, summary: `${input.role} work for ${input.featureId}` };
  };
}

export interface World {
  readonly orchestrator: Orchestrator;
  readonly repos: MemoryRepoHost;
  readonly bus: MemoryEventBus;
  readonly coder: ScriptedCoder;
  readonly checks: FakeCheckRunner;
  readonly proofs: FakeProofRunner;
  readonly apps: MemoryAppHost;
  readonly planner: TemplatePlanner;
  readonly deps: Deps;
}

export function world(options: { script: Script; presets?: Map<string, FeatureSpec>; splits?: Map<string, readonly SplitPart[]>; config?: Partial<ProjectConfig>; deps?: Partial<Deps> }): World {
  const clock = new TickingClock();
  const repos = new MemoryRepoHost(clock);
  const bus = new MemoryEventBus();
  const coder = new ScriptedCoder(options.script);
  const checks = new FakeCheckRunner(undefined, generated);
  const proofs = new FakeProofRunner(clock);
  const apps = new MemoryAppHost();
  const planner = new TemplatePlanner(options.presets ?? new Map(), options.splits ?? new Map());
  const deps: Deps = {
    repos,
    coder,
    classifier: new KeywordClassifier(),
    planner,
    reviewer: new RuleReviewer(),
    apps,
    checks,
    proofs,
    bus,
    clock,
    ids: new SequentialIds(),
    store: new MemoryStore(),
    memory: new LexicalIndex(),
    ...options.deps,
  };
  const orchestrator = new Orchestrator(deps, { name: "demo", author: { name: "chef", email: "ma.karimi76@gmail.com" }, profiles: profiles(), generated, ...options.config });
  return { orchestrator, repos, bus, coder, checks, proofs, apps, planner, deps };
}
