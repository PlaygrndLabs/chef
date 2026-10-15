import type { CheckResult } from "../ports/check-runner.ts";
import type { Plan } from "../ports/planner.ts";
import type { ReviewVerdict } from "../ports/reviewer.ts";
import type { RouteDecision } from "../router/decision.ts";
import type { Lane } from "./lanes.ts";
import type { MachineState } from "./machine.ts";

export interface PendingTurn {
  readonly id: string;
  readonly item: string;
  readonly startedAt: number;
  readonly restarts: number;
}

export interface SessionRecord {
  readonly id: string;
  readonly project: string;
  readonly featureId: string;
  readonly fork: string;
  readonly rootPrompt: string;
  readonly decision: RouteDecision;
  plan: Plan;
  cursor: number;
  machine: MachineState;
  head: string | null;
  baseMain: string | null;
  commits: string[];
  preview: { url: string; commitId: string; link?: string } | null;
  firstPreviewCommit: string | null;
  verdict: (ReviewVerdict & { commitId: string }) | null;
  lastCodeItem: string | null;
  syncPending: boolean;
  merge: { commitId: string; mainBefore: string } | null;
  ready?: { commitId: string; checks: CheckResult[]; approved: boolean } | null;
  readonly attempt: { readonly group: string; readonly index: number; readonly of: number };
  readonly kind?: "feature" | "chore";
  readonly hotfix?: boolean;
  readonly ask?: string;
  heldBy?: string | null;
  previewKey: string;
  readonly parent: string | null;
  history: string[];
  needs?: readonly string[];
  readonly requestedBy?: string;
  overBudget?: string | null;
  lanes?: Lane[] | null;
  turns?: Record<string, PendingTurn> | null;
  released?: MachineState["state"] | null;
  forkDeleted?: boolean;
  createdAt: number;
  updatedAt: number;
}
