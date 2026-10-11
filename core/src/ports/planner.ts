import type { ChangeKind, RouteIntent } from "../router/decision.ts";
import type { FeatureSpec } from "../spec/schema.ts";

export type WorkKind = "spec_change" | "test" | "code" | "fix" | "refactor" | "conflict";

export interface WorkItem {
  readonly id: string;
  readonly featureId: string;
  readonly kind: WorkKind;
  readonly role: string;
  readonly prompt: string;
  readonly acceptance: readonly string[];
}

export interface TriageInput {
  readonly prompt: string;
  readonly spec: readonly FeatureSpec[];
}

export interface Triage {
  readonly intent: RouteIntent;
  readonly featureId: string | null;
  readonly changeKind: ChangeKind | null;
  readonly confidence: number;
  readonly reason: string;
}

export interface PlanInput {
  readonly prompt: string;
  readonly intent: "new_feature" | "change_feature";
  readonly changeKind: ChangeKind | null;
  readonly featureId: string | null;
  readonly spec: readonly FeatureSpec[];
}

export interface Plan {
  readonly feature: FeatureSpec;
  readonly specChanged: boolean;
  readonly items: readonly WorkItem[];
  readonly model: string;
}

export interface Planner {
  readonly model: string;
  triage(input: TriageInput): Promise<Triage>;
  plan(input: PlanInput): Promise<Plan>;
}
