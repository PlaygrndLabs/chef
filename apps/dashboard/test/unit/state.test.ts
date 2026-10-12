import { describe, expect, it } from "vitest";
import type { FeatureSpec, KargahEvent, SessionRecord } from "@kargah/core";
import { apply, emptyProject, lessonsWithRecalls, metrics } from "../../src/lib/events.ts";
import { featureNodes, groupFeatures, matches } from "../../src/lib/model.ts";
import { transcript, type Heard } from "../../src/lib/voice.ts";

const base = { project: "demo", at: 1 };

function run(events: object[]) {
  const state = emptyProject();
  events.forEach((event, index) => apply(state, { seq: index + 1, event: { ...base, ...event } as KargahEvent }));
  return state;
}

const attempt = (index = 1, of = 1) => ({ group: "s1", index, of });

describe("project event state", () => {
  it("builds a session timeline from creation to merge", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "todo-add", fork: "demo--todo-add--s1", reason: "new", attempt: attempt(), parent: null },
      { type: "session.state", sessionId: "s1", featureId: "todo-add", from: "queued", to: "coding", reason: "planned" },
      { type: "coder.event", sessionId: "s1", featureId: "todo-add", event: { type: "assistant.message_delta", delta: "Add" } },
      { type: "coder.event", sessionId: "s1", featureId: "todo-add", event: { type: "assistant.message_delta", delta: "ing route" } },
      { type: "coder.event", sessionId: "s1", featureId: "todo-add", event: { type: "tool.execution_start", tool: "Edit", detail: "features/todo-add/index.ts" } },
      { type: "commit.created", sessionId: "s1", featureId: "todo-add", repo: "demo--todo-add--s1", commitId: "c1", role: "backend", message: "m" },
      { type: "preview.updated", sessionId: "s1", featureId: "todo-add", url: "https://p.example", commitId: "c1" },
      { type: "review.verdict", sessionId: "s1", featureId: "todo-add", approve: true, reasons: ["ok"], model: "m", head: "c1", base: "b" },
      { type: "gate.result", sessionId: "s1", featureId: "todo-add", ok: true, checks: [{ name: "lint", ok: true, log: "" }] },
      { type: "main.merged", sessionId: "s1", featureId: "todo-add", commitId: "m1" },
      { type: "session.state", sessionId: "s1", featureId: "todo-add", from: "gating", to: "merged", reason: "gate_passed" },
    ]);
    const s = state.sessions["s1"];
    expect(s?.state).toBe("merged");
    expect(s?.merged).toBe("m1");
    expect(s?.timeline.map((t) => t.kind)).toEqual(["created", "state", "text", "tool", "commit", "preview", "review", "gate", "merged", "state"]);
    expect(s?.timeline.find((t) => t.kind === "text")).toMatchObject({ text: "Adding route", phase: "coding" });
    expect(state.previews["todo-add"]?.url).toBe("https://p.example");
    expect(state.log.some((e) => e.type === "coder.event" && e.summary === "text")).toBe(false);
    expect(metrics(state)).toMatchObject({ mergedFeatures: 1, merges: 1, running: 0, stuck: 0 });
  });

  it("ignores replayed and malformed entries", () => {
    const state = run([{ type: "session.created", sessionId: "s1", featureId: "a", fork: "f", reason: "r", attempt: attempt(), parent: null }]);
    expect(apply(state, { seq: 1, event: { ...base, type: "session.created", sessionId: "s2", featureId: "b", fork: "f", reason: "r", attempt: attempt(), parent: null } })).toBe(false);
    expect(apply(state, { type: "cf_agent_state" } as never)).toBe(false);
    expect(state.order).toEqual(["s1"]);
    expect(state.lastSeq).toBe(1);
  });

  it("records stuck sessions, steering notes, picks and lessons", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "a", fork: "f1", reason: "new", attempt: attempt(1, 2), parent: null },
      { type: "session.created", sessionId: "s2", featureId: "a", fork: "f2", reason: "new", attempt: attempt(2, 2), parent: null },
      { type: "session.steered", sessionId: "s1", featureId: "a", message: "use the shared store" },
      { type: "attempt.picked", featureId: "a", group: "s1", winner: "s2", candidates: [{ sessionId: "s1", passed: 3, total: 6 }, { sessionId: "s2", passed: 6, total: 6 }], reasons: ["s2 passes"], model: "reviewer" },
      { type: "session.stuck", sessionId: "s1", featureId: "a", reason: "attempt budget exhausted (4/4)" },
      { type: "memory.recorded", featureId: "a", path: "memory/lessons/a-1.md", kind: "lesson" },
      { type: "memory.recalled", sessionId: "s2", featureId: "a", paths: ["memory/lessons/a-1.md"] },
    ]);
    expect(state.sessions["s1"]?.state).toBe("stuck");
    expect(state.sessions["s1"]?.stuck).toMatch(/budget/);
    expect(state.sessions["s1"]?.timeline.find((t) => t.kind === "steered")).toMatchObject({ message: "use the shared store" });
    expect(state.sessions["s2"]?.timeline.find((t) => t.kind === "picked")).toMatchObject({ won: true });
    expect(state.sessions["s1"]?.timeline.find((t) => t.kind === "picked")).toMatchObject({ won: false });
    expect(lessonsWithRecalls(state)).toEqual([{ featureId: "a", path: "memory/lessons/a-1.md", at: 1, recalls: 1 }]);
    expect(metrics(state)).toMatchObject({ stuck: 1, running: 1, lessonRecalls: 1 });
  });
});

describe("feature map", () => {
  const spec = (id: string, flow?: string): FeatureSpec => ({ id, title: `Feature ${id}`, status: "merged", entrypoint: "GET /", revision: 1, shared: [], acceptance: [{ id: "AC1", text: "works" }], body: "", ...(flow ? { flow } : {}) });

  it("joins main's spec with live sessions and groups shared flows", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "todo-done", fork: "f1", reason: "new", attempt: attempt(), parent: null },
      { type: "session.state", sessionId: "s1", featureId: "todo-done", from: "queued", to: "coding", reason: "planned" },
      { type: "session.created", sessionId: "s2", featureId: "todo-add", fork: "f2", reason: "change", attempt: attempt(), parent: null },
      { type: "session.stuck", sessionId: "s2", featureId: "todo-add", reason: "gate failed" },
    ]);
    const records = [{ id: "s1", featureId: "todo-done", createdAt: 1, updatedAt: 1, attempt: attempt(), machine: { state: "coding" }, plan: { feature: { ...spec("todo-done", "todo"), title: "Mark done" } } }] as unknown as SessionRecord[];
    const nodes = featureNodes(state, records, [spec("home"), spec("todo-add", "todo")]);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId["home"]?.status).toBe("merged");
    expect(byId["todo-add"]?.status).toBe("stuck");
    expect(byId["todo-done"]).toMatchObject({ status: "building", title: "Mark done", onMain: false });
    const groups = groupFeatures(nodes);
    expect(groups.map((g) => g.name)).toEqual(["todo", "Other features"]);
    expect(groups[0]?.features.map((f) => f.id)).toEqual(["todo-add", "todo-done"]);
    expect(nodes.filter((n) => matches(n, "stuck", "")).map((n) => n.id)).toEqual(["todo-add"]);
    expect(nodes.filter((n) => matches(n, "all", "s1")).map((n) => n.id)).toEqual(["todo-done"]);
  });
});

describe("voice transcript", () => {
  it("joins transcript deltas per speaker", () => {
    let lines: Heard[] = [];
    for (const event of [
      { type: "session.input_transcript.delta", delta: "Add an " },
      { type: "session.input_transcript.delta", delta: "item" },
      { type: "session.output_transcript.delta", delta: "On it." },
      { type: "session.output_audio.delta", delta: "AAAA" },
    ])
      lines = transcript(lines, event);
    expect(lines).toEqual([
      { speaker: "you", text: "Add an item" },
      { speaker: "kargah", text: "On it." },
    ]);
  });
});
