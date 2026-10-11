import type { Plan } from "../ports/planner.ts";
import type { ReviewVerdict } from "../ports/reviewer.ts";
import type { RouteDecision } from "../router/decision.ts";
import type { MachineState } from "./machine.ts";

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
  preview: { url: string; commitId: string } | null;
  firstPreviewCommit: string | null;
  verdict: (ReviewVerdict & { commitId: string }) | null;
  lastCodeItem: string | null;
  syncPending: boolean;
  merge: { commitId: string; mainBefore: string } | null;
  readonly attempt: { readonly group: string; readonly index: number; readonly of: number };
  previewKey: string;
  readonly parent: string | null;
  history: string[];
  createdAt: number;
  updatedAt: number;
}
