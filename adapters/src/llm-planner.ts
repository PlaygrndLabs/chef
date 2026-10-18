import { z } from "zod";
import { envProblem, FeatureFrontmatter, renderTurn, withGuidance, type AnswerInput, type BuilderRole, type CompactInput, type FeatureSpec, type MapInput, type MappedFeatures, type Plan, type PlanInput, type Planner, type SplitInput, type SplitPart, type Triage, type TriageInput, type WorkItem } from "@chef/core";
import { structured, type LlmEndpoint } from "./anthropic.ts";
import { cleanMapped, MappedSchema, mapPrompt } from "./feature-mapper.ts";

const TriageSchema = z.object({
  intent: z.enum(["new_feature", "change_feature", "chore", "question"]),
  featureId: z.string().nullable(),
  changeKind: z.enum(["bug", "extend", "refactor"]).nullable(),
  confidence: z.number(),
  reason: z.string(),
});

const SplitSchema = z.object({
  parts: z.array(
    z.object({
      kind: z.enum(["new", "change"]),
      prompt: z.string(),
      featureId: z.string().nullable(),
      path: z.string().nullable(),
      changeKind: z.enum(["bug", "extend", "refactor"]).nullable(),
    }),
  ),
});

const DEFAULT_BUILDERS: readonly BuilderRole[] = [
  { role: "backend", description: "Implements a feature's server code inside its vertical slice." },
  { role: "frontend", description: "Implements a feature's user interface inside its vertical slice." },
];

function planSchema(roles: readonly string[]) {
  return z.object({
    feature: z.object({
      id: z.string(),
      title: z.string(),
      entrypoint: z.string().describe("Where a person meets the feature, as `GET /path` of the page they open, for example `GET /notes`. A feature that changes another feature's page names that page. Only a feature with no page names its API route, like `POST /api/notes`."),
      shared: z.array(z.string()),
      env: z.array(z.string()),
      acceptance: z.array(z.object({ id: z.string(), text: z.string() })),
      body: z.string().describe("A few sentences of prose describing what the feature does for the person who uses it. Never empty."),
    }),
    items: z.array(z.object({ kind: z.enum(["test", "code", "fix", "refactor"]), role: z.enum(["test", ...roles] as [string, ...string[]]), prompt: z.string() })),
  });
}

type PlanResult = z.infer<ReturnType<typeof planSchema>>;

const AnswerSchema = z.object({ answer: z.string() });
const CompactSchema = z.object({ summary: z.string() });

export class LlmPlanner implements Planner {
  constructor(
    private readonly llm: LlmEndpoint,
    readonly model: string,
    private readonly system: string,
  ) {}

  async triage(input: TriageInput): Promise<Triage> {
    const features = input.spec.map((f) => ({ id: f.id, title: f.title, entrypoint: f.entrypoint }));
    const result = await structured(this.llm, {
      model: this.model,
      system: this.system,
      effort: "low",
      schema: TriageSchema,
      prompt: `Existing features:\n${JSON.stringify(features, null, 2)}\n\nRequest:\n${input.prompt}\n\nDecide whether the request is a new feature, a change to one existing feature (give its id and the kind of change), a chore (maintenance outside any one feature, like dependencies, config, shared code, docs or CI), or a question. Confidence is from 0 to 1.`,
    });
    const known = result.featureId && input.spec.some((f) => f.id === result.featureId);
    return { ...result, featureId: known ? result.featureId : null, confidence: Math.min(1, Math.max(0, result.confidence)) };
  }

  async split(input: SplitInput): Promise<readonly SplitPart[]> {
    const features = input.spec.map((f) => ({ id: f.id, title: f.title, ...(f.parent ? { parent: f.parent } : {}) }));
    const guess = input.decision.intent === "change_feature" && input.decision.featureId ? `It looks like a change to ${input.decision.featureId}.` : "It looks like new work.";
    const result = await structured(this.llm, {
      model: this.model,
      system: this.system,
      effort: "low",
      schema: SplitSchema,
      prompt: [
        `Existing features (a feature with a parent sits under it in the feature list):\n${JSON.stringify(features, null, 2)}`,
        ...mapOf(input.map),
        ...earlier(input.conversation),
        `Request:\n${input.prompt}\n\n${guess}`,
        [
          "Split the request into the features it asks for. Each part is built by its own session, in parallel with the others, so parts must not depend on each other; if one part needs another part of this same request to exist first, keep them together as one part.",
          'kind "new": a capability the product does not have yet. It goes under an existing feature only when using it takes that feature\'s steps first: the person reaches the parent and then does more there (for example "delete items" goes under the todo list: open the list, then press Delete on an item). Then give the parent\'s id in featureId and, in path, the steps that follow from where the parent leaves off. A part reached on its own, such as another page of the same app opened from its navigation or its own address, stands on its own with featureId and path null, even when it belongs to the same app, relates to an existing feature or is asked for right after it. For example the meetings page and the members page of a book club app are siblings of its reading list, not parts of it.',
          'kind "change": fixing, adjusting or refactoring what one existing feature already does. Give its id in featureId and the changeKind (bug, extend or refactor), with path null.',
          "Write each part's prompt as a short, complete request in the person's words that makes sense on its own. Most requests are a single part; never split one capability into steps.",
        ].join("\n"),
      ].join("\n\n"),
    });
    return result.parts.map((part): SplitPart => (part.kind === "change" && part.featureId ? { kind: "change", prompt: part.prompt, featureId: part.featureId, changeKind: part.changeKind ?? "extend" } : { kind: "new", prompt: part.prompt, parent: part.featureId, path: part.path }));
  }

  async plan(input: PlanInput): Promise<Plan> {
    const existing = input.featureId ? input.spec.find((f) => f.id === input.featureId) : undefined;
    const parent = input.parent ? input.spec.find((f) => f.id === input.parent) : undefined;
    const builders = input.roles?.length ? input.roles : DEFAULT_BUILDERS;
    const result = await structured(this.llm, {
      model: this.model,
      system: withGuidance(this.system, input.guidance),
      schema: planSchema(builders.map((b) => b.role)),
      prompt: [
        `Intent: ${input.intent}${input.changeKind ? ` (${input.changeKind})` : ""}`,
        `Roles for code, fix and refactor items (pick the one that fits each item; "test" items use the test role):\n${builders.map((b) => `- ${b.role}: ${b.description}`).join("\n")}`,
        "Items of different roles run at the same time, each role on its own branch, and Chef merges them into the feature; items of one role run in order. When the feature has parts that can be built apart (its server routes, its page, its look), give each part to its role as a separate item, and write into every item the contract the parts share (route paths, JSON shapes, element ids and class names, file names) so no role has to wait for another. Name one role for each shared thing, such as the .ts module that holds the page's CSS: a file belongs to the role that writes it first, and only that role may change it. Use a single role when the parts cannot be built apart.",
        existing ? `Current spec entry:\n${JSON.stringify(existing, null, 2)}` : `Existing feature ids: ${input.spec.map((f) => f.id).join(", ") || "none"}`,
        ...(parent ? [input.ownStructure ? `This feature sits under ${parent.id} (${parent.title}) and adds to it. Give it its own id, and wire it into the code where ${parent.id} already lives, for example a button on that feature's page.` : `This feature sits under ${parent.id} (${parent.title}) and adds to it. Give it its own id and folder. It may also change files in features/${parent.id}/ to wire itself in, for example a button on that feature's page.`] : input.parent ? [`This feature sits under ${input.parent} in the feature list and adds to it.`] : []),
        ...mapOf(input.map),
        `Environment: when the feature talks to an outside service or needs a key or setting the person provides, list the environment variable names it reads in env, in capital snake case like STRIPE_SECRET_KEY, and reuse a name the project already has when it fits. ${input.ownStructure ? "The app reads them at runtime from its environment" : "The app reads them at runtime from context.env"}; their values never go in the code or the spec. Set in this project: ${input.env?.map((v) => v.name).join(", ") || "none"}.`,
        ...earlier(input.conversation),
        `Request:\n${input.prompt}`,
        "Write the full spec entry for this feature, including a body of a few sentences that describes it, and the work items.",
      ].join("\n\n"),
    });
    return toPlan(result, existing, this.model);
  }

  async compact(input: CompactInput): Promise<string> {
    const result = await structured(this.llm, {
      model: this.model,
      system: this.system,
      effort: "low",
      schema: CompactSchema,
      prompt: [
        `Summary so far:\n${input.summary || "(none)"}`,
        `Messages to fold in, oldest first:\n${input.turns.map(renderTurn).join("\n\n")}`,
        "Write the new running summary of this chat between a person and Chef, the app builder. Keep what later requests may refer to: what they asked for, the feature ids Chef made, decisions, names, preferences and anything still open. Drop greetings and repetition. Use short lines, at most 300 words.",
      ].join("\n\n"),
    });
    return result.summary.trim();
  }

  async answer(input: AnswerInput): Promise<string> {
    const context = input.context.map((h) => `### ${h.doc.path}\n${h.doc.text.slice(0, 3000)}`).join("\n\n");
    const result = await structured(this.llm, {
      model: this.model,
      system: this.system,
      effort: "low",
      schema: AnswerSchema,
      prompt: `Project memory and the current builds:\n\n${context || "(empty)"}\n\n${input.map ? `The feature list (each feature's path says how to reach it from its parent; Start says how to spin up the project):\n${input.map}\n\n` : ""}Question:\n${input.question}\n\nAnswer in a few sentences using only what is above, in the language of the question, and name the files you used. For why a build failed, explain its "What failed" in plain words. If nothing above answers it, say so.`,
    });
    return result.answer;
  }

  async mapFeatures(input: MapInput): Promise<MappedFeatures> {
    const result = await structured(this.llm, { model: this.model, system: withGuidance(this.system, input.guidance), effort: "medium", schema: MappedSchema, prompt: mapPrompt(input) });
    return cleanMapped(result);
  }
}

function mapOf(map: string | undefined): string[] {
  return map ? [`The project's feature list, each with its short name and state:\n${map}`] : [];
}

function earlier(conversation: string | undefined): string[] {
  return conversation ? [`Earlier in this chat, oldest first. Use it to understand what the request refers to, and build only what the request asks:\n${conversation}`] : [];
}

export function toPlan(result: PlanResult, existing: FeatureSpec | undefined, model: string): Plan {
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
    ...(existing?.parent ? { parent: existing.parent } : {}),
    revision: existing ? existing.revision + 1 : 1,
    shared: result.feature.shared,
    env: [...new Set([...(existing?.env ?? []), ...result.feature.env.map((name) => name.trim()).filter((name) => envProblem(name) === null)])],
    acceptance,
  });
  const feature: FeatureSpec = { ...frontmatter, body: result.feature.body };
  const ids = feature.acceptance.map((c) => c.id);
  const items: WorkItem[] = [{ id: `${feature.id}-1`, featureId: feature.id, kind: "spec_change", role: "planner", prompt: `Record the spec for ${feature.id}`, acceptance: ids }];
  for (const item of result.items) items.push({ id: `${feature.id}-${items.length + 1}`, featureId: feature.id, kind: item.kind, role: item.role, prompt: item.prompt, acceptance: ids });
  if (!items.some((i) => i.kind !== "spec_change" && i.kind !== "test")) items.push({ id: `${feature.id}-${items.length + 1}`, featureId: feature.id, kind: "code", role: "backend", prompt: `Implement ${feature.id} so ${ids.join(", ")} pass.`, acceptance: ids });
  return { feature, specChanged: true, items, model };
}
