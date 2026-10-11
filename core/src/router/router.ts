import type { ChoiceAnswers, ChoiceQuestions, Classifier } from "../ports/classifier.ts";
import type { Planner } from "../ports/planner.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import type { ChangeKind, RouteDecision, RouteIntent } from "./decision.ts";

export interface RouterConfig {
  readonly thresholds: Readonly<Record<RouteIntent, number>>;
  readonly featureThreshold: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  thresholds: { new_feature: 0.85, change_feature: 0.85, question: 0.6 },
  featureThreshold: 0.85,
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

export function routingQuestions(prompt: string, spec: readonly FeatureSpec[]) {
  const featureCriteria: Record<string, string | null> = { none: "none of these features" };
  for (const feature of spec) featureCriteria[feature.id] = feature.title;
  const state = { prompt, features: spec.map((f) => ({ id: f.id, title: f.title })) };
  const questions = {
    intent: {
      type: "choice",
      instructions: "What does this request to a software builder ask for?",
      criteria: {
        new_feature: "add or build a new capability the product does not have yet",
        change_feature: "fix, extend or refactor an existing feature",
        question: "a question that needs an answer, not a code change",
      },
    },
    feature: { type: "choice", instructions: "Which existing feature does the request change?", criteria: featureCriteria },
    change: {
      type: "choice",
      instructions: "If it changes an existing feature, what kind of change is it?",
      criteria: { bug: "something is broken or wrong and must be fixed", extend: "add behavior to an existing feature", refactor: "restructure code without changing behavior" },
    },
  } as const satisfies ChoiceQuestions;
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
    const byClassifier = await this.classify(prompt, spec);
    if (byClassifier) return byClassifier;
    const triage = await this.deps.planner.triage({ prompt, spec });
    return { intent: triage.intent, featureId: triage.featureId, changeKind: triage.changeKind, via: "planner", confidence: triage.confidence, reason: triage.reason };
  }

  private async classify(prompt: string, spec: readonly FeatureSpec[]): Promise<RouteDecision | null> {
    const { state, questions } = routingQuestions(prompt, spec);
    const answers = await this.deps.classifier.choose(state, questions);
    return decideFromAnswers(answers, this.config, this.deps.classifier.model);
  }
}
