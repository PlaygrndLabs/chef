import { describe, expect, it } from "vitest";
import type { FeatureSpec, ChefEvent, SessionRecord } from "@chef/core";
import { apply, emptyProject, lessonsWithRecalls, metrics } from "../../src/lib/events.ts";
import { featureNodes, groupSessions, relationsOf, sessionNodes, sortFeatures } from "../../src/lib/model.ts";
import { activity, plainReason, progress, stripFeatureTag, toolText, updates } from "../../src/lib/progress.ts";
import { pagesFor, routesIn } from "../../src/lib/routes.ts";
import { transcript, type Heard } from "../../src/lib/voice.ts";

const base = { project: "demo", at: 1 };

function run(events: object[]) {
  const state = emptyProject();
  events.forEach((event, index) => apply(state, { seq: index + 1, event: { ...base, ...event } as ChefEvent }));
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

  it("joins main's spec with live sessions and puts features that need a person first", () => {
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
    expect(sortFeatures(nodes).map((n) => n.id)).toEqual(["todo-add", "todo-done", "home"]);
  });
});

describe("plain progress", () => {
  const timeline = (events: object[]) => run(events).sessions["s1"]?.timeline ?? [];
  const created = { type: "session.created", sessionId: "s1", featureId: "a", fork: "f", reason: "new", attempt: attempt(), parent: null };
  const to = (from: string, next: string, reason: string) => ({ type: "session.state", sessionId: "s1", featureId: "a", from, to: next, reason });

  it("tells a running build in five steps with the agent's last words", () => {
    const items = timeline([created, to("queued", "planning", "start"), to("planning", "testing", "planned"), to("testing", "coding", "tests_committed"), { type: "coder.event", sessionId: "s1", featureId: "a", event: { type: "assistant.message_delta", delta: "Adding the route" } }]);
    expect(progress("coding", items)).toMatchObject({ stage: 2, done: false, failed: false });
    const list = updates(items, "coding", { prompt: "Add a thing", at: 0 });
    expect(list.map((u) => (u.kind === "you" ? `you: ${u.text}` : `${u.tone}: ${u.text}`))).toEqual(["you: Add a thing", "ok: Planned the feature", "ok: Wrote the tests", "run: Writing the code"]);
    expect(activity("coding", items, null)).toBe("Writing the code: Adding the route");
  });

  it("explains review, gate, a fix round and going live", () => {
    const items = timeline([
      created,
      to("queued", "coding", "planned"),
      to("coding", "reviewing", "coded"),
      { type: "review.verdict", sessionId: "s1", featureId: "a", approve: false, reasons: ["missing test"], model: "m", head: "c1", base: "b" },
      to("reviewing", "coding", "review_rejected"),
      to("coding", "reviewing", "coded"),
      { type: "review.verdict", sessionId: "s1", featureId: "a", approve: true, reasons: [], model: "m", head: "c2", base: "b" },
      to("reviewing", "gating", "review_approved"),
      { type: "gate.result", sessionId: "s1", featureId: "a", ok: true, checks: [{ name: "lint", ok: true, log: "" }, { name: "unit", ok: true, log: "" }] },
      { type: "main.merged", sessionId: "s1", featureId: "a", commitId: "m1" },
      to("gating", "merged", "gate_passed"),
    ]);
    const texts = updates(items, "merged").map((u) => u.kind === "chef" ? u.text : u.text);
    expect(texts).toEqual(["Wrote the code", "A reviewer asked for changes: missing test", "Fixed what the reviewer asked for (try 2)", "A reviewer approved the change", "Passed all 2 checks", "Went live"]);
    expect(progress("merged", items)).toMatchObject({ stage: 4, done: true });
  });

  it("keeps the progress of a stuck build that was then stopped", () => {
    const items = timeline([created, to("queued", "planning", "start"), to("planning", "testing", "planned"), to("testing", "coding", "tests_committed"), to("coding", "reviewing", "coded"), to("reviewing", "stuck", "budget"), to("stuck", "dropped", "stopped")]);
    expect(progress("dropped", items)).toMatchObject({ stage: 3, stopped: true });
  });

  it("marks where a stuck build stopped", () => {
    const items = timeline([created, to("queued", "gating", "coded"), { type: "session.stuck", sessionId: "s1", featureId: "a", reason: "gate failed 4 times" }, to("gating", "stuck", "gate_failed")]);
    expect(progress("stuck", items)).toMatchObject({ stage: 3, failed: true });
    expect(activity("stuck", items, "gate failed 4 times")).toBe("gate failed 4 times");
  });
});

describe("builds by status and how they relate", () => {
  it("groups builds by what they need and links follow-ups and parallel tries", () => {
    const state = run([
      { type: "session.created", sessionId: "s1", featureId: "a", fork: "f1", reason: "new", attempt: attempt(), parent: null },
      { type: "session.state", sessionId: "s1", featureId: "a", from: "gating", to: "merged", reason: "gate_passed" },
      { type: "session.created", sessionId: "s2", featureId: "a", fork: "f2", reason: "change", attempt: { group: "s2", index: 1, of: 2 }, parent: "s1" },
      { type: "session.created", sessionId: "s3", featureId: "a", fork: "f3", reason: "change", attempt: { group: "s2", index: 2, of: 2 }, parent: "s1" },
      { type: "session.state", sessionId: "s2", featureId: "a", from: "queued", to: "coding", reason: "planned" },
      { type: "session.stuck", sessionId: "s3", featureId: "a", reason: "attempt budget exhausted (4/4)" },
      { type: "session.created", sessionId: "s4", featureId: "b", fork: "f4", reason: "new", attempt: attempt(), parent: null },
      { type: "session.state", sessionId: "s4", featureId: "b", from: "queued", to: "dropped", reason: "stopped" },
    ]);
    const nodes = sessionNodes(state, []);
    const groups = groupSessions(nodes);
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((n) => n.id)]))).toEqual({ "needs-you": ["s3"], working: ["s2"], live: ["s1"], stopped: ["s4"] });
    const s2 = nodes.find((n) => n.id === "s2");
    if (!s2) throw new Error("no s2");
    const r = relationsOf(s2, nodes);
    expect(r.parent?.id).toBe("s1");
    expect(r.attempts.map((n) => n.id)).toEqual(["s2", "s3"]);
    expect(r.chain.map((n) => n.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("explains stop reasons and hides the feature tag of a change request", () => {
    expect(plainReason("attempt budget exhausted (4/4)")).toBe("chef tried 4 times and could not get past the review and checks.");
    expect(plainReason("gate failed")).toBe("gate failed");
    expect(stripFeatureTag("#shout make it louder")).toEqual({ text: "make it louder", feature: "shout" });
    expect(stripFeatureTag("Add a page")).toEqual({ text: "Add a page", feature: null });
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
      { speaker: "chef", text: "On it." },
    ]);
  });
});

describe("pages a build added", () => {
  it("reads routes from feature code and skips tests", () => {
    const files = [
      { path: "features/notes/index.ts", after: 'export const feature = { routes: [{ method: "GET", path: "/notes", handle }, { path: "/api/notes", method: "POST", handle }] };' },
      { path: "features/notes/notes.test.ts", after: '{ method: "GET", path: "/test-only" }' },
      { path: "shared/x.ts", after: '{ method: "GET", path: "/shared" }' },
    ];
    expect(routesIn(files)).toEqual([
      { method: "GET", path: "/notes" },
      { method: "POST", path: "/api/notes" },
    ]);
  });

  it("finds routes written in other shapes and opens the feature's own page first", () => {
    const after = [
      'const page: Route = { method: "GET" as const, name: "list", path: "/notes", handle: () => html() };',
      'const api = route("POST", "/api/notes", add);',
      'app.get("/notes/new", form);',
      '{ method: "GET", path: "/api/notes", handle: list }',
      '{ method: "GET", path: "/notes/:id", handle: one }',
      '{ method: "GET", path: "/about", handle: about }',
    ].join("\n");
    const routes = routesIn([{ path: "features/notes/index.ts", after }]);
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /about", "GET /api/notes", "GET /notes", "GET /notes/:id", "GET /notes/new", "POST /api/notes"]);
    expect(pagesFor(routes, "notes").map((r) => r.path)).toEqual(["/notes", "/notes/new", "/about"]);
  });

  it("says a stopped try lost the pick", () => {
    const lost = progress("dropped", [{ kind: "picked", at: 1, won: false, winner: "s2", reasons: ["s2 passes more tests"], candidates: [] }]);
    expect(lost.now).toBe("Another try was picked over this one, so this one stopped.");
  });

  it("describes tool calls in plain words", () => {
    expect(toolText("Write", "features/notes/index.ts")).toBe("Created features/notes/index.ts");
    expect(toolText("Bash", "")).toBe("Ran a command");
    expect(toolText("Custom", "x")).toBe("Custom x");
  });
});
