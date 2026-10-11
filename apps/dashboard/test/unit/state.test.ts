import { describe, expect, it } from "vitest";
import { apply, emptyState, features, metrics, stuck } from "../../public/state.js";

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

describe("phase 3 views", () => {
  it("shows attempts, dropped losers, rejections and the revert rate", () => {
    const attempt = (index: number) => ({ group: "s1", index, of: 2 });
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "a", fork: "demo--a--s1", reason: "new", attempt: attempt(1) },
      { type: "session.created", sessionId: "s2", featureId: "a", fork: "demo--a--s2", reason: "new", attempt: attempt(2) },
      { type: "turn.rejected", sessionId: "s1", featureId: "a", role: "test", rule: "red-tests", paths: ["features/a/a.test.ts"] },
      { type: "attempt.picked", featureId: "a", group: "s1", winner: "s2", candidates: [{ sessionId: "s1", passed: 3, total: 6 }, { sessionId: "s2", passed: 6, total: 6 }], reasons: ["s2 passes every attempt's tests"], model: "reviewer" },
      { type: "session.state", sessionId: "s1", featureId: "a", from: "gating", to: "dropped", reason: "attempt s2 was picked" },
      { type: "main.merged", sessionId: "s2", featureId: "a", commitId: "m1" },
      { type: "main.reverted", featureId: "a", revertedCommit: "m1", commitId: "r1", log: "red" },
      { type: "main.merged", sessionId: "s2", featureId: "a", commitId: "m2" },
      { type: "session.state", sessionId: "s2", featureId: "a", from: "gating", to: "merged", reason: "gate_passed" },
    ]);
    const [feature] = features(state);
    expect(feature).toMatchObject({ state: "merged", merges: 2, reverts: 1, dropped: 1 });
    expect(state.sessions.s1?.rejections).toHaveLength(1);
    expect(state.picks[0]?.winner).toBe("s2");
    expect(metrics(state)).toMatchObject({ mergedFeatures: 1, merges: 2, reverts: 1, revertRate: 0.5, rejections: { "red-tests": 1 }, picks: 1, needsHuman: 0, humanActionsPerMergedFeature: 0 });
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
