export function emptyState() {
  return { lastSeq: 0, sessions: {}, order: [], merges: [], reverts: [], routes: [], log: [] };
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
      session(state, event).gate = { ok: event.ok, failed: event.checks.filter((c) => !c.ok).map((c) => c.name) };
      break;
    case "main.merged":
      push(state.merges, { featureId: event.featureId, sessionId: event.sessionId, commitId: event.commitId, at: event.at }, 100);
      break;
    case "main.reverted":
      push(state.reverts, { featureId: event.featureId, revertedCommit: event.revertedCommit, commitId: event.commitId, at: event.at }, 100);
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
    const latest = sessions[sessions.length - 1];
    const preview = [...sessions].reverse().find((s) => s.preview)?.preview ?? null;
    const merged = state.merges.some((m) => m.featureId === id);
    return { id, sessions, state: latest.state, preview, merged, stuck: sessions.filter((s) => s.state === "stuck") };
  });
}

export function stuck(state) {
  return state.order.map((id) => state.sessions[id]).filter((s) => s.state === "stuck");
}
