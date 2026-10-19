import type { AppStatus } from "../ports/app-host.ts";
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

export interface SessionApp {
  readonly status: AppStatus;
  readonly url: string | null;
  readonly local: string | null;
  readonly commitId: string;
  readonly error?: string;
  readonly link?: string;
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
  revision?: number;
  head: string | null;
  baseMain: string | null;
  commits: string[];
  app: SessionApp | null;
  firstAppCommit: string | null;
  verdict: (ReviewVerdict & { commitId: string; skipped?: boolean }) | null;
  checked?: { commitId: string; results: CheckResult[] } | null;
  lastCodeItem: string | null;
  syncPending: boolean;
  merge: { commitId: string; mainBefore: string; into?: string } | null;
  upstream?: string | null;
  upstreamBase?: string | null;
  version?: number;
  ready?: { commitId: string; checks: CheckResult[]; approved: boolean } | null;
  readonly attempt: { readonly group: string; readonly index: number; readonly of: number };
  readonly kind?: "feature" | "chore";
  readonly hotfix?: boolean;
  readonly ask?: string;
  heldBy?: string | null;
  readonly parent: string | null;
  history: string[];
  needs?: readonly string[];
  readonly requestedBy?: string;
  overBudget?: string | null;
  lanes?: Lane[] | null;
  turns?: Record<string, PendingTurn> | null;
  conversations?: Record<string, string> | null;
  released?: MachineState["state"] | null;
  forkDeleted?: boolean;
  createdAt: number;
  updatedAt: number;
}
