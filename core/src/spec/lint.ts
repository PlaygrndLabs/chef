import { parseFeature } from "./parse.ts";
import type { FeatureSpec } from "./schema.ts";

export interface SpecProblem {
  readonly path: string;
  readonly message: string;
}

export interface SpecLintResult {
  readonly features: readonly FeatureSpec[];
  readonly problems: readonly SpecProblem[];
}

export function lintSpecFiles(files: Readonly<Record<string, string>>): SpecLintResult {
  const features: FeatureSpec[] = [];
  const problems: SpecProblem[] = [];
  const seen = new Map<string, string>();
  for (const [path, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const match = /(?:^|\/)features\/([^/]+)\.md$/.exec(path);
    if (!match) continue;
    const parsed = parseFeature(source);
    if (!parsed.ok) {
      for (const message of parsed.errors) problems.push({ path, message });
      continue;
    }
    const spec = parsed.spec;
    if (spec.id !== match[1]) problems.push({ path, message: `id "${spec.id}" must match file name "${match[1]}"` });
    const previous = seen.get(spec.id);
    if (previous) problems.push({ path, message: `duplicate id "${spec.id}" also defined in ${previous}` });
    seen.set(spec.id, path);
    const acIds = new Set<string>();
    for (const criterion of spec.acceptance) {
      if (acIds.has(criterion.id)) problems.push({ path, message: `duplicate acceptance criterion ${criterion.id}` });
      acIds.add(criterion.id);
    }
    if (spec.body.length === 0) problems.push({ path, message: "body must describe the feature" });
    features.push(spec);
  }
  return { features, problems };
}

export function readSpec(tree: Readonly<Record<string, string>>): FeatureSpec[] {
  const specFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(tree)) if (path.startsWith("spec/features/")) specFiles[path] = content;
  return [...lintSpecFiles(specFiles).features];
}
