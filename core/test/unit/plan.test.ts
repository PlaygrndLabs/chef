import { describe, expect, it } from "vitest";
import { withTestItem, type Plan, type WorkItem } from "../../src/ports/planner.ts";
import { todoSpec } from "../harness.ts";

const item = (id: string, kind: WorkItem["kind"], role: string): WorkItem => ({ id, featureId: todoSpec.id, kind, role, prompt: id, acceptance: [] });

describe("plan", () => {
  it("puts a test item before the first code item when the planner wrote none", () => {
    const plan: Plan = { feature: todoSpec, specChanged: true, model: "m", items: [item("spec", "spec_change", "planner"), item("api", "code", "backend"), item("ui", "code", "frontend")] };
    const items = withTestItem(plan, "test").items;
    expect(items.map((i) => [i.kind, i.role])).toEqual([["spec_change", "planner"], ["test", "test"], ["code", "backend"], ["code", "frontend"]]);
    expect(items[1]?.acceptance).toEqual(todoSpec.acceptance.map((c) => c.id));
  });

  it("leaves plans that already test, or only refactor, as they are", () => {
    const tested: Plan = { feature: todoSpec, specChanged: true, model: "m", items: [item("t", "test", "test"), item("c", "code", "backend")] };
    const refactor: Plan = { feature: todoSpec, specChanged: false, model: "m", items: [item("r", "refactor", "backend")] };
    expect(withTestItem(tested, "test")).toBe(tested);
    expect(withTestItem(refactor, "test")).toBe(refactor);
  });
});
