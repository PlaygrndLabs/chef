import type { ChoiceAnswers, ChoiceQuestions, Classifier } from "../ports/classifier.ts";
import type { Planner } from "../ports/planner.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import type { ChangeKind, ClassifierTrace, RouteDecision, RouteIntent } from "./decision.ts";
import { NO_CLASSIFIER } from "./no-classifier.ts";

export interface RoutingWording {
  readonly intent: { readonly instructions: string; readonly criteria: Readonly<Record<RouteIntent, string>> };
  readonly feature: { readonly instructions: string; readonly none: string };
  readonly change: { readonly instructions: string; readonly criteria: Readonly<Record<ChangeKind, string>> };
}

export interface RouterConfig {
  readonly thresholds: Readonly<Record<RouteIntent, number>>;
  readonly featureThreshold: number;
  readonly useClassifier?: boolean;
  readonly wording?: RoutingWording;
}

export const DEFAULT_WORDING: RoutingWording = {
  intent: {
    instructions: "What does this request to a software builder ask for?",
    criteria: {
      new_feature: "add or build a new capability the product does not have yet",
      change_feature: "fix, extend or refactor an existing feature",
      question: "a question that needs an answer, not a code change",
    },
  },
  feature: { instructions: "Which existing feature does the request change?", none: "none of these features" },
  change: {
    instructions: "If it changes an existing feature, what kind of change is it?",
    criteria: { bug: "something is broken or wrong and must be fixed", extend: "add behavior to an existing feature", refactor: "restructure code without changing behavior" },
  },
};

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  thresholds: { new_feature: 0.85, change_feature: 0.85, question: 0.6 },
  featureThreshold: 0.85,
  useClassifier: true,
  wording: DEFAULT_WORDING,
};

const QUESTION = /^(what|how|why|which|when|who|where|is|are|does|do|can)\b[^]*\?\s*$/i;

export function changeKindFromText(text: string): ChangeKind {
  if (/\b(fix|bug|broken|crash|error|wrong|fails?)\b/i.test(text)) return "bug";
  if (/\b(refactor|clean ?up|rename|restructure)\b/i.test(text)) return "refactor";
  return "extend";
}

export function routeByRules(prompt: string, spec: readonly FeatureSpec[]): RouteDecision | null {
  const trimmed = prompt.trim();
  if (/^\/new\b/i.test(trimmed)) return { intent: "new_feature", featureId: null, changeKind: null, via: "rules", confidence: 1, reason: "explicit /new command" };
  const mention = /(?:^|\s)[@#]([a-z][a-z0-9-]*)\b/.exec(trimmed);
  if (mention) {
    const feature = spec.find((f) => f.id === mention[1]);
    if (feature) return { intent: "change_feature", featureId: feature.id, changeKind: changeKindFromText(trimmed), via: "rules", confidence: 1, reason: `explicit mention of ${feature.id}` };
  }
  if (QUESTION.test(trimmed) && !/\b(add|build|make|create|implement|fix)\b/i.test(trimmed)) return { intent: "question", featureId: null, changeKind: null, via: "rules", confidence: 1, reason: "phrased as a question" };
  return null;
}

export function routingQuestions(prompt: string, spec: readonly FeatureSpec[], wording: RoutingWording = DEFAULT_WORDING) {
  const featureCriteria: Record<string, string | null> = { none: wording.feature.none };
  for (const feature of spec) featureCriteria[feature.id] = feature.title;
  const state = { prompt, features: spec.map((f) => ({ id: f.id, title: f.title })) };
  const questions = {
    intent: { type: "choice" as const, instructions: wording.intent.instructions, criteria: { ...wording.intent.criteria } },
    feature: { type: "choice" as const, instructions: wording.feature.instructions, criteria: featureCriteria },
    change: { type: "choice" as const, instructions: wording.change.instructions, criteria: { ...wording.change.criteria } },
  } satisfies ChoiceQuestions;
  return { state, questions };
}

export type RoutingAnswers = ChoiceAnswers<ReturnType<typeof routingQuestions>["questions"]>;

export function decideFromAnswers(answers: RoutingAnswers, config: RouterConfig, model: string): RouteDecision | null {
  const intent = answers.intent.choice as RouteIntent;
  if (answers.intent.confidence < config.thresholds[intent]) return null;
  if (intent !== "change_feature") return { intent, featureId: null, changeKind: null, via: "classifier", confidence: answers.intent.confidence, reason: `classifier ${model}` };
  if (answers.feature.choice === "none" || answers.feature.confidence < config.featureThreshold) return null;
  return {
    intent,
    featureId: answers.feature.choice,
    changeKind: answers.change.choice as ChangeKind,
    via: "classifier",
    confidence: Math.min(answers.intent.confidence, answers.feature.confidence),
    reason: `classifier ${model}`,
  };
}

export class Router {
  constructor(
    private readonly deps: { readonly classifier: Classifier; readonly planner: Planner },
    private readonly config: RouterConfig = DEFAULT_ROUTER_CONFIG,
  ) {}

  async route(prompt: string, spec: readonly FeatureSpec[]): Promise<RouteDecision> {
    const byRules = routeByRules(prompt, spec);
    if (byRules) return byRules;
    const classified = await this.classify(prompt, spec);
    if (classified?.decision) return { ...classified.decision, classifier: classified.trace };
    const triage = await this.deps.planner.triage({ prompt, spec });
    return { intent: triage.intent, featureId: triage.featureId, changeKind: triage.changeKind, via: "planner", confidence: triage.confidence, reason: triage.reason, classifier: classified?.trace ?? null };
  }

  private async classify(prompt: string, spec: readonly FeatureSpec[]): Promise<{ decision: RouteDecision | null; trace: ClassifierTrace } | null> {
    if (this.config.useClassifier === false || this.deps.classifier === NO_CLASSIFIER) return null;
    const { state, questions } = routingQuestions(prompt, spec, this.config.wording);
    const answers = await this.deps.classifier.choose(state, questions);
    const decision = decideFromAnswers(answers, this.config, this.deps.classifier.model);
    return { decision, trace: { model: this.deps.classifier.model, accepted: decision !== null, answers: { intent: answers.intent, feature: answers.feature, change: answers.change } } };
  }
}
