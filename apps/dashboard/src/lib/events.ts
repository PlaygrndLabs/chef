import type { ChefEvent, RouteDecision, SessionState } from "@chef/core";

export interface LogEntry {
  readonly seq: number;
  readonly event: ChefEvent;
}

export interface CheckView {
  readonly name: string;
  readonly ok: boolean;
  readonly log: string;
}

export type TimelineItem =
  | { readonly kind: "created"; readonly at: number; readonly reason: string; readonly fork: string; readonly attempt: { readonly index: number; readonly of: number }; readonly parent: string | null }
  | { readonly kind: "state"; readonly at: number; readonly from: SessionState; readonly to: SessionState; readonly reason: string }
  | { kind: "text"; readonly at: number; text: string; readonly phase: SessionState }
  | { readonly kind: "tool"; readonly at: number; readonly tool: string; readonly detail: string; readonly phase: SessionState }
  | { readonly kind: "error"; readonly at: number; readonly message: string }
  | { readonly kind: "commit"; readonly at: number; readonly commitId: string; readonly role: string; readonly message: string }
  | { readonly kind: "preview"; readonly at: number; readonly url: string; readonly commitId: string }
  | { readonly kind: "review"; readonly at: number; readonly approve: boolean; readonly reasons: readonly string[]; readonly model: string }
  | { readonly kind: "gate"; readonly at: number; readonly ok: boolean; readonly checks: readonly CheckView[] }
  | { readonly kind: "rejected"; readonly at: number; readonly role: string; readonly rule: string; readonly paths: readonly string[] }
  | { readonly kind: "sync"; readonly at: number; readonly conflict: boolean; readonly paths: readonly string[]; readonly mainCommit: string }
  | { readonly kind: "recalled"; readonly at: number; readonly paths: readonly string[] }
  | { readonly kind: "stuck"; readonly at: number; readonly reason: string }
  | { readonly kind: "merged"; readonly at: number; readonly commitId: string }
  | { readonly kind: "picked"; readonly at: number; readonly won: boolean; readonly winner: string; readonly reasons: readonly string[]; readonly candidates: readonly { readonly sessionId: string; readonly passed: number; readonly total: number }[] }
  | { readonly kind: "steered"; readonly at: number; readonly message: string }
  | { readonly kind: "needs"; readonly at: number; readonly names: readonly string[] };

export interface SessionLive {
  readonly id: string;
  featureId: string;
  fork: string;
  state: SessionState;
  reason: string;
  attempt: { readonly group: string; readonly index: number; readonly of: number } | null;
  parent: string | null;
  commits: { readonly id: string; readonly role: string; readonly message: string }[];
  preview: { readonly url: string; readonly commitId: string; readonly link?: string | undefined } | null;
  verdict: { readonly approve: boolean; readonly reasons: readonly string[] } | null;
  gate: { readonly ok: boolean; readonly checks: readonly CheckView[] } | null;
  stuck: string | null;
  needs: readonly string[];
  merged: string | null;
  recalled: readonly string[];
  readonly timeline: TimelineItem[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectLive {
  lastSeq: number;
  lastAt: number;
  readonly sessions: Record<string, SessionLive>;
  readonly order: string[];
  readonly routes: { readonly prompt: string; readonly decision: RouteDecision; readonly at: number }[];
  readonly answers: { readonly prompt: string; readonly answer: string; readonly at: number }[];
  readonly merges: { readonly featureId: string; readonly sessionId: string; readonly commitId: string; readonly at: number }[];
  readonly reverts: { readonly featureId: string; readonly revertedCommit: string; readonly commitId: string; readonly log: string; readonly at: number }[];
  readonly lessons: { readonly featureId: string; readonly path: string; readonly at: number }[];
  readonly recalls: { readonly sessionId: string; readonly featureId: string; readonly paths: readonly string[] }[];
  readonly corrections: { readonly sessionId: string; readonly featureId: string; readonly role: string; readonly signature: string; readonly at: number }[];
  readonly rules: { readonly id: string; readonly message: string; readonly sessions: readonly string[]; readonly featureId: string; readonly at: number }[];
  readonly voice: { readonly prompt: string; readonly intent: string; readonly sessionId: string | null; readonly featureId: string | null; readonly at: number }[];
  readonly log: { readonly seq: number; readonly at: number; readonly type: string; readonly sessionId: string; readonly featureId: string; readonly summary: string }[];
  readonly previews: Record<string, { readonly url: string; readonly commitId: string; readonly link?: string | undefined; readonly sessionId: string; readonly at: number }>;
  external: { readonly type: string; readonly summary: string; readonly at: number; readonly pullRequest?: string | undefined } | null;
}

export function emptyProject(): ProjectLive {
  return { lastSeq: 0, lastAt: 0, sessions: {}, order: [], routes: [], answers: [], merges: [], reverts: [], lessons: [], recalls: [], corrections: [], rules: [], voice: [], log: [], previews: {}, external: null };
}

const TIMELINE_LIMIT = 600;
const LOG_LIMIT = 2000;

function keep<T>(list: T[], item: T, limit: number): void {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function sessionOf(state: ProjectLive, sessionId: string, featureId: string, at: number): SessionLive {
  const existing = state.sessions[sessionId];
  if (existing) {
    existing.updatedAt = at;
    return existing;
  }
  const created: SessionLive = { id: sessionId, featureId, fork: "", state: "queued", reason: "", attempt: null, parent: null, commits: [], preview: null, verdict: null, gate: null, stuck: null, needs: [], merged: null, recalled: [], timeline: [], createdAt: at, updatedAt: at };
  state.sessions[sessionId] = created;
  state.order.push(sessionId);
  return created;
}

function clip(text: string, limit = 4000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

export function summarize(event: ChefEvent): string {
  switch (event.type) {
    case "route.decided":
      return `${event.decision.intent} ${event.decision.featureId ?? ""} ${event.decision.confidence.toFixed(2)}`.trim();
    case "question.answered":
      return event.answer.slice(0, 200);
    case "session.created":
      return `fork ${event.fork} attempt ${event.attempt.index}/${event.attempt.of}`;
    case "session.state":
      return `${event.from} → ${event.to} (${event.reason})`;
    case "coder.event":
      if (event.event.type === "tool.execution_start") return `tool ${event.event.tool} ${event.event.detail ?? ""}`.trim();
      if (event.event.type === "assistant.message_delta") return "text";
      if (event.event.type === "session.error") return `error ${event.event.message}`;
      return event.event.type;
    case "commit.created":
      return `${event.role} ${event.commitId.slice(0, 7)} ${event.message}`;
    case "preview.updated":
      return `${event.url} @ ${event.commitId.slice(0, 7)}`;
    case "review.verdict":
      return event.approve ? "approved" : `rejected: ${event.reasons.join("; ")}`;
    case "gate.result":
      return event.ok ? `passed ${event.checks.length} checks` : `failed ${event.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
    case "main.merged":
      return `main ${event.commitId.slice(0, 7)}`;
    case "main.reverted":
      return `reverted ${event.revertedCommit.slice(0, 7)}`;
    case "sync.merged":
      return `synced main ${event.mainCommit.slice(0, 7)}`;
    case "sync.conflict":
      return `conflict ${event.paths.join(", ")}`;
    case "session.stuck":
      return event.reason;
    case "fork.deleted":
      return event.archived ? `fork deleted, work kept on ${event.archived}` : "fork deleted";
    case "fork.kept":
      return `fork kept: ${event.reason}`;
    case "external.pulled":
      return `${event.status} ${event.branch} ${event.commitId.slice(0, 7)} into main ${event.mainCommit.slice(0, 7)}`;
    case "external.conflict":
      return `conflict with ${event.commitId.slice(0, 7)} in ${event.paths.join(", ")}`;
    case "external.resolved":
      return `resolved, main ${event.mainCommit.slice(0, 7)}`;
    case "external.stuck":
      return `stuck on ${event.commitId.slice(0, 7)}: ${event.reason}`;
    case "external.pushed":
      return `pushed ${event.commitId.slice(0, 7)} to ${event.branch}`;
    case "external.pull-request":
      return `pull request #${event.number} from ${event.branch} (${event.features.length} features)`;
    case "session.steered":
      return event.message;
    case "session.needs":
      return event.names.length ? `needs ${event.names.join(", ")}` : "has every key it needs";
    case "turn.rejected":
      return `${event.role} ${event.rule} ${event.paths.join(", ")}`;
    case "voice.request":
      return `"${event.prompt}"`;
    case "memory.recorded":
      return `${event.kind} ${event.path}`;
    case "memory.recalled":
      return event.paths.join(", ");
    case "correction.recorded":
      return `${event.role} ${event.signature}`;
    case "lint.rule.added":
      return `${event.ruleId} ${event.message}`;
    case "attempt.picked":
      return `winner ${event.winner}`;
  }
}

export function apply(state: ProjectLive, entry: LogEntry): boolean {
  if (!entry || typeof entry.seq !== "number" || !entry.event || entry.seq <= state.lastSeq) return false;
  state.lastSeq = entry.seq;
  const event = entry.event;
  const at = event.at;
  state.lastAt = Math.max(state.lastAt, at);
  const sessionId = "sessionId" in event && typeof event.sessionId === "string" ? event.sessionId : "";
  const featureId = "featureId" in event && typeof event.featureId === "string" ? event.featureId : "";
  if (event.type !== "coder.event" || event.event.type !== "assistant.message_delta") keep(state.log, { seq: entry.seq, at, type: event.type, sessionId, featureId, summary: summarize(event) }, LOG_LIMIT);
  switch (event.type) {
    case "route.decided":
      keep(state.routes, { prompt: event.prompt, decision: event.decision, at }, 200);
      return true;
    case "question.answered":
      keep(state.answers, { prompt: event.prompt, answer: event.answer, at }, 200);
      return true;
    case "session.created": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.featureId = event.featureId;
      s.fork = event.fork;
      s.reason = event.reason;
      s.attempt = event.attempt;
      s.parent = event.parent;
      s.createdAt = at;
      keep(s.timeline, { kind: "created", at, reason: event.reason, fork: event.fork, attempt: event.attempt, parent: event.parent }, TIMELINE_LIMIT);
      return true;
    }
    case "session.state": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.state = event.to;
      s.reason = event.reason;
      if (event.to !== "stuck") s.stuck = null;
      keep(s.timeline, { kind: "state", at, from: event.from, to: event.to, reason: event.reason }, TIMELINE_LIMIT);
      return true;
    }
    case "coder.event": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const inner = event.event;
      const last = s.timeline[s.timeline.length - 1];
      if (inner.type === "assistant.message_delta") {
        if (last && last.kind === "text" && last.phase === s.state) last.text += inner.delta;
        else keep(s.timeline, { kind: "text", at, text: inner.delta, phase: s.state }, TIMELINE_LIMIT);
      } else if (inner.type === "tool.execution_start") {
        keep(s.timeline, { kind: "tool", at, tool: inner.tool, detail: inner.detail ?? "", phase: s.state }, TIMELINE_LIMIT);
      } else if (inner.type === "session.error") {
        keep(s.timeline, { kind: "error", at, message: inner.message }, TIMELINE_LIMIT);
      }
      return true;
    }
    case "commit.created": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.commits.push({ id: event.commitId, role: event.role, message: event.message });
      keep(s.timeline, { kind: "commit", at, commitId: event.commitId, role: event.role, message: event.message }, TIMELINE_LIMIT);
      return true;
    }
    case "preview.updated": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.preview = { url: event.url, commitId: event.commitId, link: event.link };
      state.previews[event.featureId] = { url: event.url, commitId: event.commitId, link: event.link, sessionId: event.sessionId, at };
      keep(s.timeline, { kind: "preview", at, url: event.url, commitId: event.commitId }, TIMELINE_LIMIT);
      return true;
    }
    case "review.verdict": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.verdict = { approve: event.approve, reasons: event.reasons };
      keep(s.timeline, { kind: "review", at, approve: event.approve, reasons: event.reasons, model: event.model }, TIMELINE_LIMIT);
      return true;
    }
    case "gate.result": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const checks = event.checks.map((c) => ({ name: c.name, ok: c.ok, log: clip(c.log ?? "") }));
      s.gate = { ok: event.ok, checks };
      keep(s.timeline, { kind: "gate", at, ok: event.ok, checks }, TIMELINE_LIMIT);
      return true;
    }
    case "main.merged": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.merged = event.commitId;
      keep(state.merges, { featureId: event.featureId, sessionId: event.sessionId, commitId: event.commitId, at }, 500);
      keep(s.timeline, { kind: "merged", at, commitId: event.commitId }, TIMELINE_LIMIT);
      return true;
    }
    case "main.reverted":
      keep(state.reverts, { featureId: event.featureId, revertedCommit: event.revertedCommit, commitId: event.commitId, log: clip(event.log), at }, 500);
      return true;
    case "sync.merged":
    case "sync.conflict": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      keep(s.timeline, { kind: "sync", at, conflict: event.type === "sync.conflict", paths: event.type === "sync.conflict" ? event.paths : [], mainCommit: event.mainCommit }, TIMELINE_LIMIT);
      return true;
    }
    case "session.stuck": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.state = "stuck";
      s.stuck = event.reason;
      keep(s.timeline, { kind: "stuck", at, reason: event.reason }, TIMELINE_LIMIT);
      return true;
    }
    case "session.steered": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      keep(s.timeline, { kind: "steered", at, message: event.message }, TIMELINE_LIMIT);
      return true;
    }
    case "session.needs": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.needs = event.names;
      keep(s.timeline, { kind: "needs", at, names: event.names }, TIMELINE_LIMIT);
      return true;
    }
    case "turn.rejected": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      keep(s.timeline, { kind: "rejected", at, role: event.role, rule: event.rule, paths: event.paths }, TIMELINE_LIMIT);
      return true;
    }
    case "voice.request":
      keep(state.voice, { prompt: event.prompt, intent: event.intent, sessionId: event.sessionId, featureId: event.featureId, at }, 100);
      return true;
    case "memory.recorded":
      if (event.kind === "lesson") keep(state.lessons, { featureId: event.featureId, path: event.path, at }, 500);
      return true;
    case "memory.recalled": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.recalled = [...event.paths];
      keep(state.recalls, { sessionId: event.sessionId, featureId: event.featureId, paths: event.paths }, 1000);
      keep(s.timeline, { kind: "recalled", at, paths: event.paths }, TIMELINE_LIMIT);
      return true;
    }
    case "correction.recorded":
      keep(state.corrections, { sessionId: event.sessionId, featureId: event.featureId, role: event.role, signature: event.signature, at }, 500);
      return true;
    case "lint.rule.added":
      if (!state.rules.some((r) => r.id === event.ruleId)) keep(state.rules, { id: event.ruleId, message: event.message, sessions: event.sessions, featureId: event.featureId, at }, 200);
      return true;
    case "attempt.picked":
      for (const candidate of event.candidates) {
        const s = state.sessions[candidate.sessionId];
        if (s) keep(s.timeline, { kind: "picked", at, won: candidate.sessionId === event.winner, winner: event.winner, reasons: event.reasons, candidates: event.candidates }, TIMELINE_LIMIT);
      }
      return true;
    case "fork.deleted":
    case "fork.kept":
      return true;
    case "external.pulled":
    case "external.conflict":
    case "external.resolved":
    case "external.stuck":
    case "external.pushed":
    case "external.pull-request":
      state.external = { type: event.type, summary: summarize(event), at, pullRequest: event.type === "external.pull-request" ? `#${event.number}` : state.external?.pullRequest };
      return true;
  }
}

export interface Metrics {
  readonly sessions: number;
  readonly running: number;
  readonly stuck: number;
  readonly mergedFeatures: number;
  readonly merges: number;
  readonly reverts: number;
  readonly revertRate: number;
  readonly lessonRecalls: number;
}

const ACTIVE: ReadonlySet<SessionState> = new Set(["queued", "planning", "testing", "coding", "reviewing", "gating"]);

export function isActive(state: SessionState): boolean {
  return ACTIVE.has(state);
}

export function metrics(state: ProjectLive): Metrics {
  const all = state.order.map((id) => state.sessions[id]).filter((s): s is SessionLive => Boolean(s));
  return {
    sessions: all.length,
    running: all.filter((s) => isActive(s.state)).length,
    stuck: all.filter((s) => s.state === "stuck").length,
    mergedFeatures: new Set(state.merges.map((m) => m.featureId)).size,
    merges: state.merges.length,
    reverts: state.reverts.length,
    revertRate: state.merges.length ? state.reverts.length / state.merges.length : 0,
    lessonRecalls: state.recalls.filter((r) => r.paths.some((p) => p.startsWith(`memory/lessons/${r.featureId}-`))).length,
  };
}

export function lessonsWithRecalls(state: ProjectLive): { readonly featureId: string; readonly path: string; readonly at: number; readonly recalls: number }[] {
  const counts = new Map<string, number>();
  for (const r of state.recalls) for (const path of r.paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  const seen = new Map(state.lessons.map((l) => [l.path, l]));
  return [...seen.values()].map((l) => ({ ...l, recalls: counts.get(l.path) ?? 0 }));
}
