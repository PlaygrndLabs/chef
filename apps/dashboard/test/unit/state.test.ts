import { describe, expect, it } from "vitest";
import { apply, emptyState, features, stuck } from "../../public/state.js";

const base = { project: "demo", at: 1 };

function run(events: object[]) {
  const state = emptyState();
  events.forEach((event, index) => apply(state, { seq: index + 1, event: { ...base, ...event } }));
  return state;
}

describe("dashboard state", () => {
  it("tracks a feature from session to merge", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "todo-add", fork: "demo--todo-add--s1", reason: "new" },
      { type: "session.state", sessionId: "s1", featureId: "todo-add", from: "queued", to: "coding", reason: "plan ready" },
      { type: "commit.created", sessionId: "s1", featureId: "todo-add", repo: "demo--todo-add--s1", commitId: "c1", role: "backend", message: "m" },
      { type: "preview.updated", sessionId: "s1", featureId: "todo-add", url: "https://p.example", commitId: "c1" },
      { type: "main.merged", sessionId: "s1", featureId: "todo-add", commitId: "m1" },
      { type: "session.state", sessionId: "s1", featureId: "todo-add", from: "gating", to: "merged", reason: "gate passed" },
    ]);
    const [feature] = features(state);
    expect(feature?.id).toBe("todo-add");
    expect(feature?.state).toBe("merged");
    expect(feature?.merged).toBe(true);
    expect(feature?.preview?.url).toBe("https://p.example");
    expect(state.sessions.s1?.commits).toHaveLength(1);
  });

  it("ignores replayed and malformed entries", () => {
    const state = run([{ type: "session.created", sessionId: "s1", featureId: "a", fork: "f", reason: "r" }]);
    apply(state, { seq: 1, event: { ...base, type: "session.created", sessionId: "s2", featureId: "b", fork: "f", reason: "r" } });
    apply(state, { type: "cf_agent_state" });
    expect(state.order).toEqual(["s1"]);
    expect(state.lastSeq).toBe(1);
  });

  it("lists stuck sessions with their reason", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "a", fork: "f", reason: "r" },
      { type: "session.stuck", sessionId: "s1", featureId: "a", reason: "attempt budget exhausted" },
    ]);
    expect(stuck(state).map((s: { stuck: string }) => s.stuck)).toEqual(["attempt budget exhausted"]);
  });
});

describe("coder stream", () => {
  it("joins message deltas into one line and keeps tools apart", () => {
    const state = run([
      { type: "coder.event", sessionId: "s1", featureId: "a", event: { type: "assistant.message_delta", delta: "Add" } },
      { type: "coder.event", sessionId: "s1", featureId: "a", event: { type: "assistant.message_delta", delta: "ing route" } },
      { type: "coder.event", sessionId: "s1", featureId: "a", event: { type: "tool.execution_start", tool: "edit", detail: "features/a/index.ts" } },
      { type: "coder.event", sessionId: "s1", featureId: "a", event: { type: "session.idle" } },
    ]);
    expect(state.sessions.s1?.coder.map((l: { text: string }) => l.text)).toEqual(["Adding route", "edit features/a/index.ts", "idle"]);
  });
});
