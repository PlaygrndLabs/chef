import type { AppStatus, ChatContext, ChefEvent, LaneStatus, RouteDecision, SessionState } from "@chef/core";

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
  | { kind: "text"; readonly at: number; text: string; readonly phase: SessionState; readonly lane?: string }
  | { readonly kind: "tool"; readonly at: number; readonly tool: string; readonly detail: string; readonly phase: SessionState; readonly lane?: string }
  | { readonly kind: "error"; readonly at: number; readonly message: string }
  | { readonly kind: "commit"; readonly at: number; readonly commitId: string; readonly role: string; readonly message: string; readonly lane?: string }
  | { readonly kind: "app"; readonly at: number; readonly status: AppStatus; readonly url: string | null; readonly commitId: string; readonly error?: string }
  | { readonly kind: "review"; readonly at: number; readonly approve: boolean; readonly reasons: readonly string[]; readonly model: string }
  | { readonly kind: "gate"; readonly at: number; readonly ok: boolean; readonly checks: readonly CheckView[] }
  | { readonly kind: "rejected"; readonly at: number; readonly role: string; readonly rule: string; readonly paths: readonly string[]; readonly lane?: string }
  | { readonly kind: "sync"; readonly at: number; readonly conflict: boolean; readonly paths: readonly string[]; readonly mainCommit: string }
  | { readonly kind: "recalled"; readonly at: number; readonly paths: readonly string[] }
  | { readonly kind: "stuck"; readonly at: number; readonly reason: string }
  | { readonly kind: "merged"; readonly at: number; readonly commitId: string }
  | { readonly kind: "picked"; readonly at: number; readonly won: boolean; readonly winner: string; readonly reasons: readonly string[]; readonly candidates: readonly { readonly sessionId: string; readonly passed: number; readonly total: number }[] }
  | { readonly kind: "steered"; readonly at: number; readonly message: string }
  | { readonly kind: "needs"; readonly at: number; readonly names: readonly string[] }
  | { readonly kind: "budget"; readonly at: number; readonly reason: string | null }
  | { readonly kind: "agent"; readonly at: number; readonly role: string; readonly model: string; readonly work: string; readonly lane?: string }
  | { readonly kind: "lanes"; readonly at: number; readonly lanes: readonly { readonly role: string; readonly branch: string; readonly items: number }[] }
  | { readonly kind: "lane"; readonly at: number; readonly role: string; readonly branch: string; readonly status: LaneStatus; readonly commitId: string | null; readonly paths: readonly string[] }
  | { readonly kind: "held"; readonly at: number; readonly by: string | null };

export interface AppView {
  readonly status: AppStatus;
  readonly url: string | null;
  readonly commitId: string;
  readonly error?: string | undefined;
  readonly link?: string | undefined;
}

export interface LaneLive {
  readonly role: string;
  readonly branch: string;
  readonly items: number;
  status: LaneStatus | "waiting";
  commits: number;
  at: number;
}

export interface SessionLive {
  readonly id: string;
  featureId: string;
  fork: string;
  state: SessionState;
  reason: string;
  attempt: { readonly group: string; readonly index: number; readonly of: number } | null;
  parent: string | null;
  kind: "feature" | "chore";
  hotfix: boolean;
  heldBy: string | null;
  commits: { readonly id: string; readonly role: string; readonly message: string }[];
  app: AppView | null;
  verdict: { readonly approve: boolean; readonly reasons: readonly string[] } | null;
  gate: { readonly ok: boolean; readonly checks: readonly CheckView[] } | null;
  stuck: string | null;
  needs: readonly string[];
  budget: string | null;
  ready: string | null;
  merged: string | null;
  recalled: readonly string[];
  agent: { readonly role: string; readonly model: string; readonly at: number } | null;
  readonly agents: { readonly role: string; readonly model: string; readonly at: number }[];
  lanes: LaneLive[];
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
  readonly spoken: { readonly voiceSessionId: string; readonly speaker: "you" | "chef"; readonly text: string; readonly startedAt: number; readonly at: number }[];
  readonly log: { readonly seq: number; readonly at: number; readonly type: string; readonly sessionId: string; readonly featureId: string; readonly summary: string }[];
  readonly apps: Record<string, AppView & { readonly sessionId: string; readonly at: number }>;
  external: { readonly type: string; readonly summary: string; readonly at: number; readonly pullRequest?: string | undefined } | null;
  context: ChatContext | null;
}

export function emptyProject(): ProjectLive {
  return { lastSeq: 0, lastAt: 0, sessions: {}, order: [], routes: [], answers: [], merges: [], reverts: [], lessons: [], recalls: [], corrections: [], rules: [], voice: [], spoken: [], log: [], apps: {}, external: null, context: null };
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
  const created: SessionLive = { id: sessionId, featureId, fork: "", state: "queued", reason: "", attempt: null, parent: null, kind: "feature", hotfix: false, heldBy: null, commits: [], app: null, verdict: null, gate: null, stuck: null, needs: [], budget: null, ready: null, merged: null, recalled: [], agent: null, agents: [], lanes: [], timeline: [], createdAt: at, updatedAt: at };
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
      return `${event.hotfix ? "hotfix " : ""}${event.kind === "chore" ? "chore " : ""}fork ${event.fork} attempt ${event.attempt.index}/${event.attempt.of}`;
    case "session.held":
      return event.by ? `waiting for hotfix ${event.by}` : "no longer waiting";
    case "session.state":
      return `${event.from} → ${event.to} (${event.reason})`;
    case "agent.started":
      return `${event.role} ${event.kind} on ${event.model}${event.lane ? ` in lane/${event.lane}` : ""}`;
    case "lanes.started":
      return `${event.lanes.map((l) => l.role).join(", ")} work at the same time`;
    case "lane.updated":
      return `${event.branch} ${event.status}${event.paths?.length ? ` ${event.paths.join(", ")}` : ""}`;
    case "coder.event":
      if (event.event.type === "tool.execution_start") return `tool ${event.event.tool} ${event.event.detail ?? ""}`.trim();
      if (event.event.type === "assistant.message_delta") return "text";
      if (event.event.type === "session.error") return `error ${event.event.message}`;
      return event.event.type;
    case "commit.created":
      return `${event.role} ${event.commitId.slice(0, 7)} ${event.message}`;
    case "app.updated":
      return `app ${event.status} at ${event.commitId.slice(0, 7)}${event.url ? ` ${event.url}` : ""}${event.error ? `: ${event.error}` : ""}`;
    case "review.verdict":
      return event.approve ? "approved" : `rejected: ${event.reasons.join("; ")}`;
    case "gate.result":
      return event.ok ? `passed ${event.checks.length} checks` : `failed ${event.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
    case "main.merged":
      return `main ${event.commitId.slice(0, 7)}`;
    case "main-app.updated":
      return `main app ${event.status} at ${event.commitId.slice(0, 7)}${event.error ? `: ${event.error}` : ""}`;
    case "main.reverted":
      return `reverted ${event.revertedCommit.slice(0, 7)}`;
    case "chat.context":
      return `chat context ${event.used} of ${event.limit} tokens`;
    case "feature.arranged":
      return [event.title ? `renamed to ${event.title}` : null, `under ${event.parent ?? "the app"}`].filter(Boolean).join(", ");
    case "features.removed":
      return `deleted ${event.featureIds.join(", ")}`;
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
    case "session.ready":
      return event.commitId ? `ready to merge at ${event.commitId.slice(0, 7)}` : "merge approved";
    case "session.needs":
      return event.names.length ? `needs ${event.names.join(", ")}` : "has every key it needs";
    case "session.budget":
      return event.reason ?? "back within budget";
    case "turn.rejected":
      return `${event.role} ${event.rule} ${event.paths.join(", ")}`;
    case "voice.request":
      return `"${event.prompt}"`;
    case "voice.turn":
      return `${event.speaker}: ${event.text}`;
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
      s.kind = event.kind ?? "feature";
      s.hotfix = event.hotfix === true;
      s.createdAt = at;
      keep(s.timeline, { kind: "created", at, reason: event.reason, fork: event.fork, attempt: event.attempt, parent: event.parent }, TIMELINE_LIMIT);
      return true;
    }
    case "session.state": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.state = event.to;
      s.reason = event.reason;
      if (event.to !== "stuck") s.stuck = null;
      if (event.to !== "gating") s.ready = null;
      keep(s.timeline, { kind: "state", at, from: event.from, to: event.to, reason: event.reason }, TIMELINE_LIMIT);
      return true;
    }
    case "session.ready": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.ready = event.commitId;
      return true;
    }
    case "session.held": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.heldBy = event.by;
      keep(s.timeline, { kind: "held", at, by: event.by }, TIMELINE_LIMIT);
      return true;
    }
    case "agent.started": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const agent = { role: event.role, model: event.model, at };
      s.agent = agent;
      keep(s.agents, agent, 100);
      keep(s.timeline, { kind: "agent", at, role: event.role, model: event.model, work: event.kind, ...(event.lane ? { lane: event.lane } : {}) }, TIMELINE_LIMIT);
      return true;
    }
    case "lanes.started": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.lanes = event.lanes.map((l) => ({ role: l.role, branch: l.branch, items: l.items, status: "waiting", commits: 0, at }));
      keep(s.timeline, { kind: "lanes", at, lanes: event.lanes }, TIMELINE_LIMIT);
      return true;
    }
    case "lane.updated": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const lane = s.lanes.find((l) => l.role === event.role);
      if (lane) {
        lane.status = event.status;
        lane.at = at;
        if (event.status === "committed") lane.commits++;
      } else s.lanes.push({ role: event.role, branch: event.branch, items: 0, status: event.status, commits: event.status === "committed" ? 1 : 0, at });
      keep(s.timeline, { kind: "lane", at, role: event.role, branch: event.branch, status: event.status, commitId: event.commitId ?? null, paths: event.paths ?? [] }, TIMELINE_LIMIT);
      return true;
    }
    case "coder.event": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const inner = event.event;
      const lane = event.lane ? { lane: event.lane } : {};
      const last = event.lane ? lastOfLane(s.timeline, event.lane) : s.timeline[s.timeline.length - 1];
      if (inner.type === "assistant.message_delta") {
        if (last && last.kind === "text" && last.phase === s.state) last.text += inner.delta;
        else keep(s.timeline, { kind: "text", at, text: inner.delta, phase: s.state, ...lane }, TIMELINE_LIMIT);
      } else if (inner.type === "tool.execution_start") {
        keep(s.timeline, { kind: "tool", at, tool: inner.tool, detail: inner.detail ?? "", phase: s.state, ...lane }, TIMELINE_LIMIT);
      } else if (inner.type === "session.error") {
        keep(s.timeline, { kind: "error", at, message: inner.message }, TIMELINE_LIMIT);
      }
      return true;
    }
    case "commit.created": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.commits.push({ id: event.commitId, role: event.role, message: event.message });
      keep(s.timeline, { kind: "commit", at, commitId: event.commitId, role: event.role, message: event.message, ...(event.lane ? { lane: event.lane } : {}) }, TIMELINE_LIMIT);
      return true;
    }
    case "app.updated": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      const app: AppView = { status: event.status, url: event.url, commitId: event.commitId, error: event.error, link: event.link };
      s.app = app;
      state.apps[event.featureId] = { ...app, sessionId: event.sessionId, at };
      keep(s.timeline, { kind: "app", at, status: event.status, url: event.url, commitId: event.commitId, ...(event.error ? { error: event.error } : {}) }, TIMELINE_LIMIT);
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
    case "session.budget": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      s.budget = event.reason;
      keep(s.timeline, { kind: "budget", at, reason: event.reason }, TIMELINE_LIMIT);
      return true;
    }
    case "turn.rejected": {
      const s = sessionOf(state, event.sessionId, event.featureId, at);
      keep(s.timeline, { kind: "rejected", at, role: event.role, rule: event.rule, paths: event.paths, ...(event.lane ? { lane: event.lane } : {}) }, TIMELINE_LIMIT);
      return true;
    }
    case "voice.request":
      keep(state.voice, { prompt: event.prompt, intent: event.intent, sessionId: event.sessionId, featureId: event.featureId, at }, 100);
      return true;
    case "voice.turn":
      keep(state.spoken, { voiceSessionId: event.voiceSessionId, speaker: event.speaker, text: event.text, startedAt: event.startedAt, at }, 400);
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
    case "main-app.updated":
    case "feature.arranged":
    case "features.removed":
      return true;
    case "chat.context":
      state.context = { used: event.used, limit: event.limit, turns: event.turns, summarized: event.summarized };
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

function lastOfLane(timeline: readonly TimelineItem[], lane: string): TimelineItem | undefined {
  for (let i = timeline.length - 1; i >= Math.max(0, timeline.length - LANE_LOOKBACK); i--) {
    const item = timeline[i];
    if (item && "lane" in item && item.lane === lane) return item;
    if (item?.kind === "state" || item?.kind === "lanes" || (item?.kind === "lane" && item.role === lane)) return undefined;
  }
  return undefined;
}

const LANE_LOOKBACK = 80;

const ACTIVE: ReadonlySet<SessionState> = new Set(["queued", "planning", "testing", "coding", "reviewing", "gating"]);

export function isActive(state: SessionState): boolean {
  return ACTIVE.has(state);
}
