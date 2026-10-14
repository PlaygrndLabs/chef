import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@chef/core";
import type { SessionLive } from "../../src/lib/events.ts";
import { laneSummary } from "../../src/lib/agents.ts";
import type { SessionNode } from "../../src/lib/model.ts";

function node(state: SessionNode["state"], live: Partial<SessionLive>, lanes: SessionRecord["lanes"]): SessionNode {
  return { id: "s1", featureId: "todo", state, attempt: null, parent: null, createdAt: 0, updatedAt: 0, needs: [], budget: null, live: { commits: [], lanes: [], ...live } as SessionLive, record: { lanes } as SessionRecord };
}

const lanes = [
  { role: "backend", branch: "lane/backend", items: ["b1", "b2"], part: null, done: 1, rework: false, feedback: null, head: "c2", owns: ["features/todo/backend/routes.ts"] },
  { role: "frontend", branch: "lane/frontend", items: ["f1"], part: null, done: 0, rework: false, feedback: null, head: null },
];

describe("one role's lane", () => {
  it("shows its branch, live status, steps, commits and owned files", () => {
    const n = node("coding", { lanes: [{ role: "backend", branch: "lane/backend", items: 2, status: "working", commits: 1, at: 1 }], commits: [{ id: "c1", role: "test", message: "tests" }, { id: "c2", role: "backend", message: "api" }] }, lanes);
    expect(laneSummary(n, "backend")).toEqual({ branch: "lane/backend", status: "Working on its part", steps: { done: 1, of: 2 }, commits: 1, owns: ["features/todo/backend/routes.ts"] });
  });

  it("falls back to the saved record when the live feed has no lanes", () => {
    expect(laneSummary(node("coding", {}, lanes), "frontend")).toMatchObject({ branch: "lane/frontend", status: "Waiting for its turn", steps: { done: 0, of: 1 }, owns: [] });
  });

  it("says when the work went live or was cut off", () => {
    expect(laneSummary(node("merged", {}, lanes), "backend")?.status).toBe("Its work went live with the feature");
    const stopped = node("stuck", { lanes: [{ role: "frontend", branch: "lane/frontend", items: 1, status: "working", commits: 0, at: 1 }] }, lanes);
    expect(laneSummary(stopped, "frontend")?.status).toBe("Was working when Chef stopped");
  });

  it("has nothing for a role without its own branch", () => {
    expect(laneSummary(node("coding", {}, lanes), "planner")).toBeNull();
  });
});
