export type RouteIntent = "new_feature" | "change_feature" | "question";

export type ChangeKind = "bug" | "extend" | "refactor";

export interface RouteDecision {
  readonly intent: RouteIntent;
  readonly featureId: string | null;
  readonly changeKind: ChangeKind | null;
  readonly via: "rules" | "classifier" | "planner";
  readonly confidence: number;
  readonly reason: string;
}
