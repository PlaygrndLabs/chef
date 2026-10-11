import { join } from "node:path";
import { loadProfiles, Orchestrator, type Deps, type FeatureSpec, type ProjectConfig, type Tree } from "@kargah/core";
import { FakeCheckRunner, FakeProofRunner, KeywordClassifier, MemoryEventBus, MemoryPreviewHost, MemoryRepoHost, MemoryStore, RuleReviewer, ScriptedCoder, SequentialIds, TemplatePlanner, TickingClock, type Script } from "@kargah/core/fakes";
import { renderRegistry } from "@kargah/template/gen";
import { readTree } from "./fs.ts";
import { LocalCheckRunner, LocalProofRunner } from "./local/runners.ts";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");

export const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

export function templateTree(): Tree {
  return readTree(join(REPO_ROOT, "template"));
}

export function repoProfiles() {
  return loadProfiles(readTree(join(REPO_ROOT, "agents")));
}

export interface LocalWorldOptions {
  readonly script: Script;
  readonly presets?: ReadonlyMap<string, FeatureSpec>;
  readonly real?: boolean;
  readonly config?: Partial<ProjectConfig>;
  readonly deps?: Partial<Deps>;
}

export function localWorld(options: LocalWorldOptions) {
  const clock = new TickingClock();
  const repos = new MemoryRepoHost(clock);
  const bus = new MemoryEventBus();
  const coder = new ScriptedCoder(options.script);
  const previews = new MemoryPreviewHost();
  const nodeModules = join(REPO_ROOT, "template", "node_modules");
  const deps: Deps = {
    repos,
    coder,
    classifier: new KeywordClassifier(),
    planner: new TemplatePlanner(options.presets ?? new Map()),
    reviewer: new RuleReviewer(),
    previews,
    checks: options.real ? new LocalCheckRunner(nodeModules) : new FakeCheckRunner(undefined, generated),
    proofs: options.real ? new LocalProofRunner(nodeModules, clock) : new FakeProofRunner(clock),
    bus,
    clock,
    ids: new SequentialIds(),
    store: new MemoryStore(),
    ...options.deps,
  };
  const orchestrator = new Orchestrator(deps, { name: "demo", author: { name: "kargah", email: "ma.karimi76@gmail.com" }, profiles: repoProfiles(), generated, ...options.config });
  return { orchestrator, repos, bus, coder, previews, deps };
}
