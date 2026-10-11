export function emptyState() {
  return { lastSeq: 0, sessions: {}, order: [], merges: [], reverts: [], routes: [], picks: [], rejections: [], memory: [], recalls: [], corrections: [], rules: [], log: [] };
}

function session(state, event) {
  const existing = state.sessions[event.sessionId];
  if (existing) return existing;
  const created = {
    id: event.sessionId,
    featureId: event.featureId,
    fork: "",
    state: "queued",
    reason: "",
    commits: [],
    preview: null,
    verdict: null,
    gate: null,
    stuck: null,
    attempt: null,
    parent: null,
    recalled: [],
    rejections: [],
    coder: [],
  };
  state.sessions[event.sessionId] = created;
  state.order.push(event.sessionId);
  return created;
}

function push(list, item, keep) {
  list.push(item);
  if (list.length > keep) list.splice(0, list.length - keep);
}

function coderEvent(lines, event) {
  const last = lines[lines.length - 1];
  if (event.type === "assistant.message_delta") {
    if (last && last.kind === "text") last.text += event.delta;
    else push(lines, { kind: "text", text: event.delta }, 40);
  } else if (event.type === "tool.execution_start") {
    push(lines, { kind: "tool", text: event.detail ? `${event.tool} ${event.detail}` : event.tool }, 40);
  } else if (event.type === "session.error") {
    push(lines, { kind: "error", text: event.message }, 40);
  } else {
    push(lines, { kind: "idle", text: "idle" }, 40);
  }
}

export function apply(state, entry) {
  if (!entry || typeof entry.seq !== "number" || !entry.event || entry.seq <= state.lastSeq) return state;
  state.lastSeq = entry.seq;
  const event = entry.event;
  push(state.log, { seq: entry.seq, at: event.at, type: event.type, featureId: event.featureId ?? "", sessionId: event.sessionId ?? "" }, 300);
  switch (event.type) {
    case "route.decided":
      push(state.routes, { prompt: event.prompt, decision: event.decision }, 50);
      break;
    case "session.created": {
      const s = session(state, event);
      s.fork = event.fork;
      s.reason = event.reason;
      s.attempt = event.attempt ?? null;
      s.parent = event.parent ?? null;
      break;
    }
    case "session.state": {
      const s = session(state, event);
      s.state = event.to;
      s.reason = event.reason;
      break;
    }
    case "coder.event":
      coderEvent(session(state, event).coder, event.event);
      break;
    case "commit.created":
      session(state, event).commits.push({ id: event.commitId, role: event.role, message: event.message });
      break;
    case "preview.updated":
      session(state, event).preview = { url: event.url, commitId: event.commitId };
      break;
    case "review.verdict":
      session(state, event).verdict = { approve: event.approve, reasons: event.reasons };
      break;
    case "gate.result":
      session(state, event).gate = { ok: event.ok, checks: event.checks.map((c) => ({ name: c.name, ok: c.ok })), failed: event.checks.filter((c) => !c.ok).map((c) => c.name) };
      break;
    case "main.merged":
      push(state.merges, { featureId: event.featureId, sessionId: event.sessionId, commitId: event.commitId, at: event.at }, 100);
      break;
    case "main.reverted":
      push(state.reverts, { featureId: event.featureId, revertedCommit: event.revertedCommit, commitId: event.commitId, at: event.at }, 100);
      break;
    case "turn.rejected": {
      const rejection = { sessionId: event.sessionId, featureId: event.featureId, role: event.role, rule: event.rule, paths: event.paths, at: event.at };
      push(session(state, event).rejections, rejection, 20);
      push(state.rejections, rejection, 200);
      break;
    }
    case "memory.recorded":
      push(state.memory, { featureId: event.featureId, path: event.path, kind: event.kind, at: event.at }, 200);
      break;
    case "memory.recalled":
      session(state, event).recalled = [...event.paths];
      push(state.recalls, { sessionId: event.sessionId, featureId: event.featureId, paths: event.paths, at: event.at }, 200);
      break;
    case "correction.recorded":
      push(state.corrections, { sessionId: event.sessionId, featureId: event.featureId, role: event.role, signature: event.signature, at: event.at }, 200);
      break;
    case "lint.rule.added":
      if (!state.rules.some((r) => r.id === event.ruleId)) push(state.rules, { id: event.ruleId, message: event.message, sessions: event.sessions, featureId: event.featureId, at: event.at }, 100);
      break;
    case "attempt.picked":
      push(state.picks, { featureId: event.featureId, group: event.group, winner: event.winner, candidates: event.candidates, reasons: event.reasons, model: event.model, at: event.at }, 100);
      break;
    case "session.stuck": {
      const s = session(state, event);
      s.state = "stuck";
      s.stuck = event.reason;
      break;
    }
    default:
      break;
  }
  return state;
}

export function features(state) {
  const byFeature = new Map();
  for (const id of state.order) {
    const s = state.sessions[id];
    const list = byFeature.get(s.featureId) ?? [];
    list.push(s);
    byFeature.set(s.featureId, list);
  }
  return [...byFeature].map(([id, sessions]) => {
    const live = sessions.filter((s) => s.state !== "dropped");
    const latest = live[live.length - 1] ?? sessions[sessions.length - 1];
    const preview = [...live].reverse().find((s) => s.preview)?.preview ?? null;
    const merges = state.merges.filter((m) => m.featureId === id).length;
    const reverts = state.reverts.filter((r) => r.featureId === id).length;
    return { id, sessions, state: latest.state, preview, merged: merges > 0, merges, reverts, dropped: sessions.filter((s) => s.state === "dropped").length, stuck: sessions.filter((s) => s.state === "stuck") };
  });
}

export function metrics(state) {
  const all = state.order.map((id) => state.sessions[id]);
  const mergedFeatures = new Set(all.filter((s) => s.state === "merged").map((s) => s.featureId));
  const byRule = {};
  for (const r of state.rejections) byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
  const stuckCount = all.filter((s) => s.state === "stuck").length;
  return {
    sessions: all.length,
    mergedFeatures: mergedFeatures.size,
    merges: state.merges.length,
    reverts: state.reverts.length,
    revertRate: state.merges.length ? state.reverts.length / state.merges.length : 0,
    rejections: byRule,
    picks: state.picks.length,
    lessons: state.memory.filter((m) => m.kind === "lesson").length,
    lessonRecalls: state.recalls.filter((r) => r.paths.some((p) => p.startsWith(`memory/lessons/${r.featureId}-`))).length,
    corrections: state.corrections.length,
    rules: state.rules.length,
    needsHuman: stuckCount,
    humanActionsPerMergedFeature: mergedFeatures.size ? stuckCount / mergedFeatures.size : 0,
  };
}

export function stuck(state) {
  return state.order.map((id) => state.sessions[id]).filter((s) => s.state === "stuck");
}

export function memory(state) {
  const lessons = new Map();
  for (const m of state.memory) if (m.kind === "lesson") lessons.set(m.path, { ...m, recalls: 0 });
  for (const r of state.recalls) for (const path of r.paths) if (lessons.has(path)) lessons.get(path).recalls++;
  return { lessons: [...lessons.values()], rules: state.rules };
}
