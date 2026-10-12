import type { ChangeKind, RouteIntent } from "../router/decision.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import type { MemoryHit } from "./memory-index.ts";

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

export interface AnswerInput {
  readonly question: string;
  readonly context: readonly MemoryHit[];
}

export interface Planner {
  readonly model: string;
  triage(input: TriageInput): Promise<Triage>;
  plan(input: PlanInput): Promise<Plan>;
  answer?(input: AnswerInput): Promise<string>;
}

export function withTestItem(plan: Plan, role: string): Plan {
  const changesBehavior = plan.items.some((i) => i.kind === "code" || i.kind === "fix");
  if (!changesBehavior || plan.items.some((i) => i.kind === "test")) return plan;
  const ids = plan.feature.acceptance.map((c) => c.id);
  const test: WorkItem = {
    id: `${plan.feature.id}-tests`,
    featureId: plan.feature.id,
    kind: "test",
    role,
    prompt: `Write failing tests for ${plan.feature.id}, one per acceptance criterion (${ids.join(", ")}), each named after its criterion id, and its flow.ts.`,
    acceptance: ids,
  };
  const at = plan.items.findIndex((i) => i.kind !== "spec_change");
  return { ...plan, items: [...plan.items.slice(0, at), test, ...plan.items.slice(at)] };
}
