import type { Plan, PlanInput, Planner, Triage, TriageInput, WorkItem } from "../ports/planner.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import { slugify } from "../util/hash.ts";

const STOP = new Set(["a", "an", "the", "to", "of", "for", "and", "with", "in", "on", "my", "our", "please", "can", "you", "i", "want", "we", "need"]);

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export class TemplatePlanner implements Planner {
  readonly model = "fake-template-planner";
  readonly triaged: TriageInput[] = [];
  readonly planned: PlanInput[] = [];

  private readonly normalized: ReadonlyMap<string, FeatureSpec>;

  constructor(private readonly presets: ReadonlyMap<string, FeatureSpec> = new Map()) {
    this.normalized = new Map([...presets].map(([prompt, spec]) => [normalize(prompt), spec]));
  }

  private preset(prompt: string): FeatureSpec | undefined {
    return this.presets.get(prompt) ?? this.normalized.get(normalize(prompt));
  }

  async triage(input: TriageInput): Promise<Triage> {
    this.triaged.push(input);
    const text = input.prompt.toLowerCase();
    if (/^(what|how|why|which|when|who)\b.*\?$/.test(text.trim())) return { intent: "question", featureId: null, changeKind: null, confidence: 0.9, reason: "phrased as a question" };
    const preset = this.preset(input.prompt);
    if (preset) return { intent: input.spec.some((f) => f.id === preset.id) ? "change_feature" : "new_feature", featureId: preset.id, changeKind: null, confidence: 0.95, reason: "preset" };
    let best: { id: string; score: number } | null = null;
    const promptWords = new Set(text.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
    for (const feature of input.spec) {
      const featureWords = `${feature.id.replace(/-/g, " ")} ${feature.title.toLowerCase()}`.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
      const score = featureWords.filter((w) => promptWords.has(w)).length / Math.max(1, new Set(featureWords).size);
      if (!best || score > best.score) best = { id: feature.id, score };
    }
    if (best && best.score >= 0.5) {
      const changeKind = /\b(fix|bug|broken|crash|error|wrong)\b/.test(text) ? "bug" : /\b(refactor|clean|rename)\b/.test(text) ? "refactor" : "extend";
      return { intent: "change_feature", featureId: best.id, changeKind, confidence: 0.8, reason: `matches feature ${best.id}` };
    }
    return { intent: "new_feature", featureId: null, changeKind: null, confidence: 0.8, reason: "no existing feature matches" };
  }

  async plan(input: PlanInput): Promise<Plan> {
    this.planned.push(input);
    const existing = input.featureId ? input.spec.find((f) => f.id === input.featureId) : undefined;
    const preset = this.preset(input.prompt);
    let feature: FeatureSpec;
    let specChanged = true;
    if (preset) {
      feature = existing ? { ...preset, revision: existing.revision + 1 } : preset;
      specChanged = !existing || JSON.stringify({ ...existing, revision: 0 }) !== JSON.stringify({ ...preset, revision: 0 });
      if (!specChanged && existing) feature = existing;
    } else if (existing) {
      if (input.changeKind === "extend") {
        const next = existing.acceptance.length + 1;
        feature = { ...existing, revision: existing.revision + 1, status: "building", acceptance: [...existing.acceptance, { id: `AC${next}`, text: input.prompt }] };
      } else {
        feature = existing;
        specChanged = false;
      }
    } else {
      const title = input.prompt.trim().replace(/[.!]+$/, "");
      const id = slugify(title.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).join(" "), 40) || "feature";
      feature = {
        id,
        title: title.charAt(0).toUpperCase() + title.slice(1),
        status: "building",
        entrypoint: `GET /${id}`,
        revision: 1,
        shared: [],
        env: [],
        acceptance: title.split(/\s*(?:;|\band then\b)\s*/).map((text, i) => ({ id: `AC${i + 1}`, text })),
        body: title,
      };
    }
    const acceptance = feature.acceptance.map((c) => c.id);
    const items: WorkItem[] = [];
    const add = (kind: WorkItem["kind"], role: string, prompt: string) => items.push({ id: `${feature.id}-${items.length + 1}`, featureId: feature.id, kind, role, prompt, acceptance });
    if (specChanged) add("spec_change", "planner", `Record the spec for ${feature.id}`);
    if (!existing || input.changeKind !== "refactor") add("test", "test", `Write failing tests for ${feature.id} covering ${acceptance.join(", ")}: ${input.prompt}`);
    const codeKind = !existing ? "code" : input.changeKind === "bug" ? "fix" : input.changeKind === "refactor" ? "refactor" : "code";
    add(codeKind, "backend", `${input.prompt}\n\nImplement ${feature.id} so that ${acceptance.join(", ")} pass.`);
    return { feature, specChanged, items, model: this.model };
  }
}
