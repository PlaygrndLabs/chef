import { describe, expect, it } from "vitest";
import { described } from "../../src/orchestrator/orchestrator.ts";
import { withTestItem, type Plan, type WorkItem } from "../../src/ports/planner.ts";
import { lintSpecFiles } from "../../src/spec/lint.ts";
import { renderFeature } from "../../src/spec/parse.ts";
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

  it("describes a feature with the request when the planner left its description out, so the spec passes the merge gate", () => {
    const bare: Plan = { feature: { ...todoSpec, body: "  " }, specChanged: true, model: "m", items: [] };
    const plan = described(bare, "Build a notes page with an API and a page");
    expect(plan.feature.body).toBe("Build a notes page with an API and a page");
    expect(lintSpecFiles({ [`spec/features/${todoSpec.id}.md`]: renderFeature(plan.feature) }).problems).toEqual([]);
    const written: Plan = { ...bare, feature: todoSpec };
    expect(described(written, "anything")).toBe(written);
  });
});
