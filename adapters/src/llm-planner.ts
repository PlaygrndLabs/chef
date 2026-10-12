import { z } from "zod";
import { FeatureFrontmatter, type AnswerInput, type FeatureSpec, type Plan, type PlanInput, type Planner, type Triage, type TriageInput, type WorkItem } from "@chef/core";
import { DEFAULT_MODEL, structured, type LlmEndpoint } from "./anthropic.ts";

const TriageSchema = z.object({
  intent: z.enum(["new_feature", "change_feature", "question"]),
  featureId: z.string().nullable(),
  changeKind: z.enum(["bug", "extend", "refactor"]).nullable(),
  confidence: z.number(),
  reason: z.string(),
});

const PlanSchema = z.object({
  feature: z.object({
    id: z.string(),
    title: z.string(),
    entrypoint: z.string(),
    shared: z.array(z.string()),
    acceptance: z.array(z.object({ id: z.string(), text: z.string() })),
    body: z.string(),
  }),
  items: z.array(z.object({ kind: z.enum(["test", "code", "fix", "refactor"]), role: z.enum(["test", "backend", "frontend"]), prompt: z.string() })),
});

const AnswerSchema = z.object({ answer: z.string() });

const SYSTEM = `You are the planner of chef, a spec-driven builder. The spec is the memory: one feature per entry, each with acceptance criteria that a user can observe through the feature's entrypoint.
Projects use vertical slices: features/<id>/ holds a feature's code, its tests named after acceptance criterion ids ("AC1: ..."), and flow.ts, which drives the entrypoint. shared/ holds contracts; list a shared path only when the feature must change it.
Feature ids are lowercase kebab-case, at most 40 characters. Acceptance criterion ids are AC1, AC2 and so on.
Never remove or weaken an existing acceptance criterion; add new ones with the next free id.
Work items run in order. Write a "test" item first whenever behavior changes, then the implementation items.`;

export class LlmPlanner implements Planner {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string = DEFAULT_MODEL,
  ) {}

  async triage(input: TriageInput): Promise<Triage> {
    const features = input.spec.map((f) => ({ id: f.id, title: f.title, entrypoint: f.entrypoint }));
    const result = await structured(this.llm, {
      model: this.model,
      system: SYSTEM,
      effort: "low",
      schema: TriageSchema,
      prompt: `Existing features:\n${JSON.stringify(features, null, 2)}\n\nRequest:\n${input.prompt}\n\nDecide whether the request is a new feature, a change to one existing feature (give its id and the kind of change), or a question. Confidence is from 0 to 1.`,
    });
    const known = result.featureId && input.spec.some((f) => f.id === result.featureId);
    return { ...result, featureId: known ? result.featureId : null, confidence: Math.min(1, Math.max(0, result.confidence)) };
  }

  async plan(input: PlanInput): Promise<Plan> {
    const existing = input.featureId ? input.spec.find((f) => f.id === input.featureId) : undefined;
    const result = await structured(this.llm, {
      model: this.model,
      system: SYSTEM,
      schema: PlanSchema,
      prompt: [
        `Intent: ${input.intent}${input.changeKind ? ` (${input.changeKind})` : ""}`,
        existing ? `Current spec entry:\n${JSON.stringify(existing, null, 2)}` : `Existing feature ids: ${input.spec.map((f) => f.id).join(", ") || "none"}`,
        `Request:\n${input.prompt}`,
        "Write the full spec entry for this feature and the work items.",
      ].join("\n\n"),
    });
    return toPlan(result, existing, this.model);
  }

  async answer(input: AnswerInput): Promise<string> {
    const context = input.context.map((h) => `### ${h.doc.path}\n${h.doc.text.slice(0, 3000)}`).join("\n\n");
    const result = await structured(this.llm, {
      model: this.model,
      system: SYSTEM,
      effort: "low",
      schema: AnswerSchema,
      prompt: `Project memory:\n\n${context || "(empty)"}\n\nQuestion:\n${input.question}\n\nAnswer in a few sentences using only the project memory above, and name the files you used. If the memory does not answer it, say so.`,
    });
    return result.answer;
  }
}

export function toPlan(result: z.infer<typeof PlanSchema>, existing: FeatureSpec | undefined, model: string): Plan {
  const acceptance = [...(existing?.acceptance ?? [])];
  for (const criterion of result.feature.acceptance) {
    const index = acceptance.findIndex((c) => c.id === criterion.id);
    if (index < 0) acceptance.push(criterion);
  }
  const frontmatter = FeatureFrontmatter.parse({
    id: existing?.id ?? result.feature.id,
    title: result.feature.title,
    status: "building",
    entrypoint: result.feature.entrypoint,
    revision: existing ? existing.revision + 1 : 1,
    shared: result.feature.shared,
    acceptance,
  });
  const feature: FeatureSpec = { ...frontmatter, body: result.feature.body };
  const ids = feature.acceptance.map((c) => c.id);
  const items: WorkItem[] = [{ id: `${feature.id}-1`, featureId: feature.id, kind: "spec_change", role: "planner", prompt: `Record the spec for ${feature.id}`, acceptance: ids }];
  for (const item of result.items) items.push({ id: `${feature.id}-${items.length + 1}`, featureId: feature.id, kind: item.kind, role: item.role, prompt: item.prompt, acceptance: ids });
  if (!items.some((i) => i.kind !== "spec_change" && i.kind !== "test")) items.push({ id: `${feature.id}-${items.length + 1}`, featureId: feature.id, kind: "code", role: "backend", prompt: `Implement ${feature.id} so ${ids.join(", ")} pass.`, acceptance: ids });
  return { feature, specChanged: true, items, model };
}
