import type { ChoiceAnswer } from "../ports/classifier.ts";

export type RouteIntent = "new_feature" | "change_feature" | "question";

export type ChangeKind = "bug" | "extend" | "refactor";

export interface RouteDecision {
  readonly intent: RouteIntent;
  readonly featureId: string | null;
  readonly changeKind: ChangeKind | null;
  readonly via: "rules" | "classifier" | "planner";
  readonly confidence: number;
  readonly reason: string;
  readonly classifier?: ClassifierTrace | null;
}

export interface ClassifierTrace {
  readonly model: string;
  readonly accepted: boolean;
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
}
