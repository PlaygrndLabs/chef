import type { CheckResult } from "../ports/check-runner.ts";
import type { CoderEvent } from "../ports/coder.ts";
import type { RouteDecision } from "../router/decision.ts";
import type { RejectionRule, SessionState } from "../session/machine.ts";
import type { AttemptScore } from "../ports/reviewer.ts";

interface Base {
  readonly project: string;
  readonly at: number;
}

export type KargahEvent = Base &
  (
    | { readonly type: "route.decided"; readonly prompt: string; readonly decision: RouteDecision }
    | { readonly type: "session.created"; readonly sessionId: string; readonly featureId: string; readonly fork: string; readonly reason: string; readonly attempt: { readonly group: string; readonly index: number; readonly of: number } }
    | { readonly type: "session.state"; readonly sessionId: string; readonly featureId: string; readonly from: SessionState; readonly to: SessionState; readonly reason: string }
    | { readonly type: "coder.event"; readonly sessionId: string; readonly featureId: string; readonly event: CoderEvent }
    | { readonly type: "commit.created"; readonly sessionId: string; readonly featureId: string; readonly repo: string; readonly commitId: string; readonly role: string; readonly message: string }
    | { readonly type: "preview.updated"; readonly sessionId: string; readonly featureId: string; readonly url: string; readonly commitId: string }
    | { readonly type: "review.verdict"; readonly sessionId: string; readonly featureId: string; readonly approve: boolean; readonly reasons: readonly string[] }
    | { readonly type: "gate.result"; readonly sessionId: string; readonly featureId: string; readonly ok: boolean; readonly checks: readonly CheckResult[] }
    | { readonly type: "main.merged"; readonly sessionId: string; readonly featureId: string; readonly commitId: string }
    | { readonly type: "main.reverted"; readonly featureId: string; readonly revertedCommit: string; readonly commitId: string; readonly log: string }
    | { readonly type: "sync.merged"; readonly sessionId: string; readonly featureId: string; readonly commitId: string; readonly mainCommit: string }
    | { readonly type: "sync.conflict"; readonly sessionId: string; readonly featureId: string; readonly paths: readonly string[]; readonly mainCommit: string }
    | { readonly type: "session.stuck"; readonly sessionId: string; readonly featureId: string; readonly reason: string }
    | { readonly type: "turn.rejected"; readonly sessionId: string; readonly featureId: string; readonly role: string; readonly rule: RejectionRule; readonly paths: readonly string[] }
    | { readonly type: "attempt.picked"; readonly featureId: string; readonly group: string; readonly winner: string; readonly candidates: readonly AttemptScore[]; readonly reasons: readonly string[]; readonly model: string }
  );

export type KargahEventType = KargahEvent["type"];

export type EventOf<T extends KargahEventType> = Extract<KargahEvent, { type: T }>;
