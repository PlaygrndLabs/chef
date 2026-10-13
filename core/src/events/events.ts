import type { CheckResult } from "../ports/check-runner.ts";
import type { CoderEvent } from "../ports/coder.ts";
import type { RouteDecision } from "../router/decision.ts";
import type { RejectionRule, SessionState } from "../session/machine.ts";
import type { AttemptScore } from "../ports/reviewer.ts";

interface Base {
  readonly project: string;
  readonly at: number;
}

export type ChefEvent = Base &
  (
    | { readonly type: "route.decided"; readonly prompt: string; readonly decision: RouteDecision }
    | { readonly type: "question.answered"; readonly prompt: string; readonly answer: string; readonly sources: readonly string[] }
    | { readonly type: "session.created"; readonly sessionId: string; readonly featureId: string; readonly fork: string; readonly reason: string; readonly attempt: { readonly group: string; readonly index: number; readonly of: number }; readonly parent: string | null; readonly kind?: "feature" | "chore"; readonly hotfix?: boolean }
    | { readonly type: "session.held"; readonly sessionId: string; readonly featureId: string; readonly by: string | null }
    | { readonly type: "session.state"; readonly sessionId: string; readonly featureId: string; readonly from: SessionState; readonly to: SessionState; readonly reason: string }
    | { readonly type: "agent.started"; readonly sessionId: string; readonly featureId: string; readonly role: string; readonly kind: string; readonly model: string }
    | { readonly type: "coder.event"; readonly sessionId: string; readonly featureId: string; readonly event: CoderEvent }
    | { readonly type: "commit.created"; readonly sessionId: string; readonly featureId: string; readonly repo: string; readonly commitId: string; readonly role: string; readonly message: string }
    | { readonly type: "preview.updated"; readonly sessionId: string; readonly featureId: string; readonly url: string; readonly commitId: string; readonly link?: string }
    | { readonly type: "review.verdict"; readonly sessionId: string; readonly featureId: string; readonly approve: boolean; readonly reasons: readonly string[]; readonly model: string; readonly head: string; readonly base: string }
    | { readonly type: "gate.result"; readonly sessionId: string; readonly featureId: string; readonly ok: boolean; readonly checks: readonly CheckResult[] }
    | { readonly type: "main.merged"; readonly sessionId: string; readonly featureId: string; readonly commitId: string }
    | { readonly type: "main.reverted"; readonly featureId: string; readonly revertedCommit: string; readonly commitId: string; readonly log: string }
    | { readonly type: "sync.merged"; readonly sessionId: string; readonly featureId: string; readonly commitId: string; readonly mainCommit: string }
    | { readonly type: "sync.conflict"; readonly sessionId: string; readonly featureId: string; readonly paths: readonly string[]; readonly mainCommit: string }
    | { readonly type: "fork.deleted"; readonly sessionId: string; readonly featureId: string; readonly fork: string; readonly archived: string | null }
    | { readonly type: "fork.kept"; readonly sessionId: string; readonly featureId: string; readonly fork: string; readonly reason: string }
    | { readonly type: "external.pulled"; readonly url: string; readonly branch: string; readonly commitId: string; readonly mainCommit: string; readonly status: string }
    | { readonly type: "external.conflict"; readonly url: string; readonly syncId: string; readonly commitId: string; readonly paths: readonly string[] }
    | { readonly type: "external.resolved"; readonly url: string; readonly syncId: string; readonly mainCommit: string }
    | { readonly type: "external.stuck"; readonly url: string; readonly commitId: string; readonly reason: string }
    | { readonly type: "external.pushed"; readonly url: string; readonly branch: string; readonly commitId: string }
    | { readonly type: "external.pull-request"; readonly url: string; readonly number: number; readonly branch: string; readonly features: readonly string[] }
    | { readonly type: "session.stuck"; readonly sessionId: string; readonly featureId: string; readonly reason: string }
    | { readonly type: "session.steered"; readonly sessionId: string; readonly featureId: string; readonly message: string }
    | { readonly type: "turn.rejected"; readonly sessionId: string; readonly featureId: string; readonly role: string; readonly rule: RejectionRule; readonly paths: readonly string[] }
    | { readonly type: "voice.request"; readonly voiceSessionId: string; readonly delegationId: string; readonly prompt: string; readonly intent: string; readonly sessionId: string | null; readonly featureId: string | null }
    | { readonly type: "memory.recorded"; readonly featureId: string; readonly path: string; readonly kind: "lesson" | "feature" }
    | { readonly type: "memory.recalled"; readonly sessionId: string; readonly featureId: string; readonly paths: readonly string[] }
    | { readonly type: "correction.recorded"; readonly sessionId: string; readonly featureId: string; readonly role: string; readonly signature: string; readonly correctionId: string }
    | { readonly type: "lint.rule.added"; readonly sessionId: string; readonly featureId: string; readonly ruleId: string; readonly message: string; readonly sessions: readonly string[]; readonly evidence: readonly string[] }
    | { readonly type: "attempt.picked"; readonly featureId: string; readonly group: string; readonly winner: string; readonly candidates: readonly AttemptScore[]; readonly reasons: readonly string[]; readonly model: string }
  );

export type ChefEventType = ChefEvent["type"];

export type EventOf<T extends ChefEventType> = Extract<ChefEvent, { type: T }>;
