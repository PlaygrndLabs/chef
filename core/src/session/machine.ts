export const SESSION_STATES = ["queued", "planning", "testing", "coding", "reviewing", "gating", "merged", "stuck", "dropped"] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export type SessionEvent =
  | { readonly type: "start" }
  | { readonly type: "planned"; readonly withTests: boolean }
  | { readonly type: "tests_committed" }
  | { readonly type: "coded" }
  | { readonly type: "review_approved" }
  | { readonly type: "review_rejected"; readonly reasons: readonly string[] }
  | { readonly type: "gate_passed" }
  | { readonly type: "gate_failed"; readonly log: string }
  | { readonly type: "conflict"; readonly paths: readonly string[] }
  | { readonly type: "turn_rejected"; readonly rule: RejectionRule; readonly paths: readonly string[]; readonly scope: readonly string[]; readonly detail?: string }
  | { readonly type: "reopened"; readonly log: string; readonly charged?: boolean }
  | { readonly type: "dropped"; readonly reason: string }
  | { readonly type: "fail"; readonly reason: string };

export type RejectionRule = "write-scope" | "locked-tests" | "red-tests" | "project-lint";

export interface Budget {
  readonly maxAttempts: number;
  readonly maxTokens: number;
  readonly maxMillis: number;
}

export const DEFAULT_BUDGET: Budget = { maxAttempts: 4, maxTokens: 2_000_000, maxMillis: 60 * 60 * 1000 };

export interface Usage {
  readonly attempts: number;
  readonly tokens: number;
  readonly startedAt: number;
}

export interface MachineState {
  readonly state: SessionState;
  readonly usage: Usage;
  readonly feedback: string | null;
  readonly reason: string;
}

const NEXT: Readonly<Record<SessionEvent["type"], Partial<Record<SessionState, SessionState>>>> = {
  start: { queued: "planning" },
  planned: { planning: "coding" },
  tests_committed: { testing: "coding" },
  coded: { coding: "reviewing" },
  review_approved: { reviewing: "gating" },
  review_rejected: { reviewing: "coding" },
  gate_passed: { gating: "merged" },
  gate_failed: { gating: "coding" },
  conflict: { planning: "coding", testing: "coding", coding: "coding", reviewing: "coding", gating: "coding" },
  turn_rejected: { testing: "testing", coding: "coding" },
  reopened: { merged: "coding", stuck: "coding" },
  dropped: { planning: "dropped", testing: "dropped", coding: "dropped", reviewing: "dropped", gating: "dropped" },
  fail: { queued: "stuck", planning: "stuck", testing: "stuck", coding: "stuck", reviewing: "stuck", gating: "stuck" },
};

export class InvalidTransition extends Error {
  constructor(
    readonly from: SessionState,
    readonly event: SessionEvent["type"],
  ) {
    super(`cannot apply ${event} in state ${from}`);
  }
}

export function isTerminal(state: SessionState): boolean {
  return state === "merged" || state === "stuck" || state === "dropped";
}

export function exceeded(usage: Usage, budget: Budget, now: number): string | null {
  if (usage.attempts > budget.maxAttempts) return `attempt budget exhausted (${usage.attempts - 1}/${budget.maxAttempts})`;
  if (usage.tokens > budget.maxTokens) return `token budget exhausted (${usage.tokens}/${budget.maxTokens})`;
  if (now - usage.startedAt > budget.maxMillis) return `time budget exhausted (${now - usage.startedAt}ms/${budget.maxMillis}ms)`;
  return null;
}

export function transition(current: MachineState, event: SessionEvent, budget: Budget, now: number): MachineState {
  let to = NEXT[event.type][current.state];
  if (event.type === "planned" && current.state === "planning" && event.withTests) to = "testing";
  if (!to) throw new InvalidTransition(current.state, event.type);
  const retry = event.type === "review_rejected" || event.type === "gate_failed" || event.type === "turn_rejected" || (event.type === "reopened" && event.charged !== false);
  const usage: Usage = retry ? { ...current.usage, attempts: current.usage.attempts + 1 } : current.usage;
  const carried = (to === "coding" || to === "testing") && event.type !== "tests_committed" && event.type !== "planned";
  const feedback = feedbackOf(event) ?? (carried ? current.feedback : null);
  const reason = event.type === "fail" || event.type === "dropped" ? event.reason : event.type;
  if (to === "coding" || event.type === "turn_rejected") {
    const over = exceeded(usage, budget, now);
    if (over) return { state: "stuck", usage, feedback, reason: over };
  }
  return { state: to, usage, feedback, reason };
}

function feedbackOf(event: SessionEvent): string | null {
  switch (event.type) {
    case "review_rejected":
      return `Reviewer rejected the change:\n${event.reasons.map((r) => `- ${r}`).join("\n")}`;
    case "gate_failed":
      return `Merge gate failed:\n${event.log}`;
    case "conflict":
      return `Merging main produced conflicts in:\n${event.paths.map((p) => `- ${p}`).join("\n")}`;
    case "turn_rejected":
      return rejectionFeedback(event);
    case "reopened":
      return `Main went red after this feature merged and the merge was reverted:\n${event.log}`;
    default:
      return null;
  }
}

export function initialMachine(now: number): MachineState {
  return { state: "queued", usage: { attempts: 1, tokens: 0, startedAt: now }, feedback: null, reason: "created" };
}

export function addTokens(machine: MachineState, tokens: number): MachineState {
  return { ...machine, usage: { ...machine.usage, tokens: machine.usage.tokens + tokens } };
}

function rejectionFeedback(event: Extract<SessionEvent, { type: "turn_rejected" }>): string {
  const paths = event.paths.map((p) => `- ${p}`).join("\n");
  switch (event.rule) {
    case "write-scope":
      return `Your last turn wrote outside your write scope and was discarded.\nRejected paths:\n${paths}\nAllowed scope:\n${event.scope.map((p) => `- ${p}`).join("\n")}`;
    case "locked-tests":
      return `Your last turn changed tests the test agent wrote. They are locked, so the turn was discarded. Make the code pass them instead.\nLocked paths:\n${paths}`;
    case "project-lint":
      return `Your last turn broke a project lint rule the gardener learned from earlier corrections, so it was discarded.\n${event.detail ?? ""}`.trim();
    case "red-tests":
      return `Your tests were discarded because some of them pass before the feature is implemented, so they do not test it. Make every new test exercise the feature through its entrypoint.\n${event.detail ?? ""}\nFiles:\n${paths}`.trim();
  }
}
