import type { ChatTurn } from "../router/conversation.ts";
import type { ChangeKind, RouteIntent } from "../router/decision.ts";
import type { FeatureSpec } from "../spec/schema.ts";
import type { EnvVar } from "../env/env.ts";
import type { Tree } from "../git/tree.ts";
import type { MappedFeatures } from "../features/mapping.ts";
import type { MemoryHit } from "./memory-index.ts";

export type WorkKind = "spec_change" | "test" | "code" | "fix" | "refactor" | "chore" | "conflict";

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

export interface CompactInput {
  readonly summary: string;
  readonly turns: readonly ChatTurn[];
}

export interface SplitInput {
  readonly prompt: string;
  readonly spec: readonly FeatureSpec[];
  readonly decision: { readonly intent: "new_feature" | "change_feature"; readonly featureId: string | null; readonly changeKind: ChangeKind | null };
  readonly conversation?: string;
  readonly map?: string;
}

export type SplitPart =
  | { readonly kind: "new"; readonly prompt: string; readonly parent: string | null; readonly path: string | null }
  | { readonly kind: "change"; readonly prompt: string; readonly featureId: string; readonly changeKind: ChangeKind };

export interface BuilderRole {
  readonly role: string;
  readonly description: string;
}

export interface PlanInput {
  readonly prompt: string;
  readonly intent: "new_feature" | "change_feature";
  readonly changeKind: ChangeKind | null;
  readonly featureId: string | null;
  readonly parent?: string | null;
  readonly spec: readonly FeatureSpec[];
  readonly env?: readonly EnvVar[];
  readonly roles?: readonly BuilderRole[];
  readonly conversation?: string;
  readonly guidance?: string;
  readonly map?: string;
  readonly ownStructure?: boolean;
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
  readonly map?: string;
}

export interface MapInput {
  readonly project: string;
  readonly tree: Tree;
  readonly map: string;
  readonly guidance?: string;
}

export interface Planner {
  readonly model: string;
  triage(input: TriageInput): Promise<Triage>;
  plan(input: PlanInput): Promise<Plan>;
  split?(input: SplitInput): Promise<readonly SplitPart[]>;
  answer?(input: AnswerInput): Promise<string>;
  compact?(input: CompactInput): Promise<string>;
  mapFeatures?(input: MapInput): Promise<MappedFeatures>;
}

const FILLER = new Set(["a", "an", "the", "to", "of", "and", "or", "for", "in", "on", "at", "with", "our", "my", "all", "this", "its", "please", "chore", "hotfix", "project", "app", "code", "codebase", "repo", "repository"]);

const CHORE_TITLE_CHARS = 60;
const CHORE_SLUG_CHARS = 28;

export function choreTitle(prompt: string): string {
  const first = (prompt.trim().split("\n")[0] ?? "").trim();
  const clause = first.split(/:\s|[.!?](?=\s|$)/)[0]?.trim() || first;
  if (clause.length <= CHORE_TITLE_CHARS) return clause || "Chore";
  const cut = clause.slice(0, CHORE_TITLE_CHARS + 1);
  const space = cut.lastIndexOf(" ");
  return (space > CHORE_TITLE_CHARS / 2 ? cut.slice(0, space) : cut.slice(0, CHORE_TITLE_CHARS)).replace(/[\s,;:-]+$/, "");
}

export function choreId(prompt: string, taken: ReadonlySet<string>): string {
  const words = (choreTitle(prompt).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !FILLER.has(w));
  const kept: string[] = [];
  for (const word of words.slice(0, 4)) {
    if ([...kept, word].join("-").length > CHORE_SLUG_CHARS) break;
    kept.push(word);
  }
  const base = `chore-${kept.join("-") || "work"}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function chorePlan(featureId: string, prompt: string, role: string): Plan {
  const title = choreTitle(prompt);
  return {
    feature: { id: featureId, title, status: "building", entrypoint: "src/index.ts", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: prompt.trim().slice(0, 500) || title }], body: prompt.trim() },
    specChanged: false,
    items: [{ id: `${featureId}-chore`, featureId, kind: "chore", role, prompt: prompt.trim(), acceptance: ["AC1"] }],
    model: "chef",
  };
}

export function withTestItem(plan: Plan, role: string, flow = true): Plan {
  const changesBehavior = plan.items.some((i) => i.kind === "code" || i.kind === "fix");
  if (!changesBehavior || plan.items.some((i) => i.kind === "test")) return plan;
  const ids = plan.feature.acceptance.map((c) => c.id);
  const test: WorkItem = {
    id: `${plan.feature.id}-tests`,
    featureId: plan.feature.id,
    kind: "test",
    role,
    prompt: flow ? `Write failing tests for ${plan.feature.id}, one per acceptance criterion (${ids.join(", ")}), each named after its criterion id, and its flow.ts.` : `Write failing tests for ${plan.feature.id} with the repository's own test tool, one per acceptance criterion (${ids.join(", ")}), each named after its criterion id.`,
    acceptance: ids,
  };
  const at = plan.items.findIndex((i) => i.kind !== "spec_change");
  return { ...plan, items: [...plan.items.slice(0, at), test, ...plan.items.slice(at)] };
}
