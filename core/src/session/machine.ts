export const SESSION_STATES = ["queued", "planning", "testing", "coding", "reviewing", "gating", "merged", "stuck", "dropped"] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export type SessionEvent =
  | { readonly type: "start" }
  | { readonly type: "planned"; readonly withTests: boolean }
  | { readonly type: "tests_committed" }
  | { readonly type: "coded" }
  | { readonly type: "review_approved" }
  | { readonly type: "review_rejected"; readonly reasons: readonly string[]; readonly retest?: boolean }
  | { readonly type: "gate_passed" }
  | { readonly type: "gate_failed"; readonly log: string; readonly signature?: string }
  | { readonly type: "tests_disputed"; readonly said: readonly string[] }
  | { readonly type: "app_failed"; readonly log: string }
  | { readonly type: "conflict"; readonly paths: readonly string[]; readonly between?: readonly string[] }
  | { readonly type: "turn_rejected"; readonly rule: RejectionRule; readonly paths: readonly string[]; readonly scope: readonly string[]; readonly detail?: string }
  | { readonly type: "reopened"; readonly log: string; readonly charged?: boolean }
  | { readonly type: "dropped"; readonly reason: string }
  | { readonly type: "retried"; readonly guidance: string }
  | { readonly type: "fail"; readonly reason: string };

export type RejectionRule = "write-scope" | "locked-tests" | "red-tests" | "project-lint" | "lane-owner";

export interface Budget {
  readonly maxAttempts: number;
  readonly maxRepeats: number;
}

export const DEFAULT_BUDGET: Budget = { maxAttempts: 4, maxRepeats: 3 };

export interface Usage {
  readonly attempts: number;
  readonly tokens: number;
  readonly startedAt: number;
  readonly failures?: readonly string[];
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
  gate_failed: { gating: "coding", coding: "coding" },
  tests_disputed: { coding: "testing" },
  app_failed: { coding: "coding", reviewing: "coding" },
  conflict: { planning: "coding", testing: "coding", coding: "coding", reviewing: "coding", gating: "coding" },
  turn_rejected: { testing: "testing", coding: "coding" },
  reopened: { merged: "coding", stuck: "coding" },
  dropped: { queued: "dropped", planning: "dropped", testing: "dropped", coding: "dropped", reviewing: "dropped", gating: "dropped", stuck: "dropped" },
  retried: { stuck: "coding" },
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

export function exceeded(usage: Usage, budget: Budget): string | null {
  const repeats = timesSeen(usage.failures ?? [], usage.failures?.at(-1));
  if (repeats >= budget.maxRepeats) return `same failure repeated (${repeats}/${budget.maxRepeats})`;
  if (usage.attempts > budget.maxAttempts) return `attempt budget exhausted (${usage.attempts - 1}/${budget.maxAttempts})`;
  return null;
}

export function failureFingerprint(text: string): string {
  const normal = text
    .toLowerCase()
    .replace(/\d{4}-\d\d-\d\dt[\d:.]+z?/g, "#")
    .replace(/\b[0-9a-f]{7,}\b/g, "#")
    .replace(/\d+(\.\d+)?\s?(ms|s|sec|seconds?|m|min)\b/g, "#")
    .replace(/:\d+(:\d+)?\b/g, ":#")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normal.length; i++) hash = Math.imul(hash ^ normal.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function timesSeen(failures: readonly string[], fingerprint: string | undefined): number {
  return fingerprint ? failures.filter((f) => f === fingerprint).length : 0;
}

const LOOP_EVENTS: ReadonlySet<SessionEvent["type"]> = new Set(["review_rejected", "gate_failed", "app_failed", "turn_rejected", "conflict", "reopened"]);

const REPEAT_NOTE = "This is the same failure as an earlier try, so the last approach did not work. Find the root cause and take a different approach instead of repeating the same fix.";

export function transition(current: MachineState, event: SessionEvent, budget: Budget, now: number): MachineState {
  let to = NEXT[event.type][current.state];
  if (event.type === "planned" && current.state === "planning" && event.withTests) to = "testing";
  if (event.type === "review_rejected" && current.state === "reviewing" && event.retest) to = "testing";
  if (!to) throw new InvalidTransition(current.state, event.type);
  const retry = event.type === "review_rejected" || event.type === "gate_failed" || event.type === "app_failed" || event.type === "turn_rejected" || (event.type === "reopened" && event.charged !== false);
  const charged: Usage = event.type === "retried" ? { attempts: 1, tokens: 0, startedAt: now } : retry ? { ...current.usage, attempts: current.usage.attempts + 1 } : current.usage;
  const failed = feedbackOf(event, current);
  const fingerprint = failed !== null && LOOP_EVENTS.has(event.type) && !(event.type === "reopened" && event.charged === false) && !(event.type === "conflict" && !event.between?.length) ? failureFingerprint(event.type === "gate_failed" && event.signature ? event.signature : failed) : null;
  const usage: Usage = fingerprint ? { ...charged, failures: [...(charged.failures ?? []), fingerprint].slice(-20) } : charged;
  const repeated = fingerprint !== null && timesSeen(charged.failures ?? [], fingerprint) > 0;
  const carried = (to === "coding" || to === "testing") && event.type !== "planned" && (event.type !== "tests_committed" || current.reason === "review_rejected" || current.reason === "tests_disputed");
  const fresh = event.type === "retried" ? retriedFeedback(event.guidance, current.feedback) : (failed ?? (carried ? current.feedback : null));
  const feedback = repeated && fresh ? `${fresh}\n\n${REPEAT_NOTE}` : fresh;
  const reason = event.type === "fail" || event.type === "dropped" ? event.reason : event.type;
  if (to === "coding" || event.type === "turn_rejected" || event.type === "review_rejected") {
    const over = exceeded(usage, budget);
    if (over) return { state: "stuck", usage, feedback, reason: event.type === "app_failed" ? `${over}; the app still does not start` : over };
  }
  return { state: to, usage, feedback, reason };
}

function feedbackOf(event: SessionEvent, current: MachineState): string | null {
  switch (event.type) {
    case "review_rejected":
      return `Reviewer rejected the change:\n${event.reasons.map((r) => `- ${r}`).join("\n")}`;
    case "gate_failed":
      return `Merge gate failed:\n${event.log}`;
    case "tests_disputed":
      return `The merge gate failed and the coders then changed no code, so the failing tests go back to the test writer: a test that contradicts the spec or itself gets fixed, and a test that is right stays for the code to pass.\n${current.feedback ?? ""}\n\nWhat the coders said:\n${event.said.map((s) => `- ${s}`).join("\n")}`;
    case "app_failed":
      return `The app did not start on the latest commit, so the change was not reviewed. Make it build and start again:\n${event.log}`;
    case "conflict":
      return event.between?.length
        ? `The ${event.between.join(", ")} roles worked at the same time and changed the same lines. Merging their branches produced conflicts in:\n${event.paths.map((p) => `- ${p}`).join("\n")}\nKeep what every role meant to do.`
        : `Merging main produced conflicts in:\n${event.paths.map((p) => `- ${p}`).join("\n")}`;
    case "turn_rejected":
      return rejectionFeedback(event);
    case "reopened":
      return `Main went red after this feature merged and the merge was reverted:\n${event.log}`;
    default:
      return null;
  }
}

function retriedFeedback(guidance: string, last: string | null): string {
  const note = guidance.trim() ? `A person retried this session and asked:\n${guidance.trim()}` : "A person retried this session with a fresh budget.";
  return last ? `${note}\n\nThe last failure was:\n${last}` : note;
}

export function initialMachine(now: number): MachineState {
  return { state: "queued", usage: { attempts: 1, tokens: 0, startedAt: now }, feedback: null, reason: "created" };
}

export function addTokens(machine: MachineState, tokens: number): MachineState {
  return { ...machine, usage: { ...machine.usage, tokens: machine.usage.tokens + tokens } };
}

export function rejectionFeedback(event: Extract<SessionEvent, { type: "turn_rejected" }>): string {
  const paths = event.paths.map((p) => `- ${p}`).join("\n");
  switch (event.rule) {
    case "write-scope":
      return `Your last turn wrote outside your write scope and was discarded.\nRejected paths:\n${paths}\nAllowed scope:\n${event.scope.map((p) => `- ${p}`).join("\n")}`;
    case "locked-tests":
      return `Your last turn changed tests the test agent wrote. They are locked, so the turn was discarded. Make the code pass them instead.\nLocked paths:\n${paths}`;
    case "project-lint":
      return `Your last turn broke a project lint rule the gardener learned from earlier corrections, so it was discarded.\n${event.detail ?? ""}`.trim();
    case "lane-owner":
      return `Your last turn changed files another role in this feature owns, so it was discarded. Only a file's owner changes it: build what you need in your own files and use theirs as they are.\n${event.detail ?? paths}`.trim();
    case "red-tests":
      return `Your tests were discarded because some of them pass before the feature is implemented, so they do not test it. Make every new test exercise the feature through its entrypoint.\n${event.detail ?? ""}\nFiles:\n${paths}`.trim();
  }
}
