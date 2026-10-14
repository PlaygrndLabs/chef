import { describe, expect, it } from "vitest";
import type { SpendGate } from "../../src/usage/budget.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";

function gate() {
  const spent: { by: string | null; model: string }[] = [];
  let reason: string | null = null;
  const scopes: (string | null)[] = [];
  const spend: SpendGate = {
    blocked: async () => reason,
    record: async (by, model) => void spent.push({ by, model }),
    scope: async (by, work) => {
      scopes.push(by);
      return work();
    },
  };
  return { spend, spent, scopes, block: (next: string | null) => void (reason = next) };
}

describe("spend budgets", () => {
  it("charges coder turns to the person who asked and pauses work over budget until it is lifted", async () => {
    const g = gate();
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), deps: { spend: g.spend } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt, { by: "usr_sam" });
    expect(g.scopes[0]).toBe("usr_sam");
    expect((await w.orchestrator.session(sessionId as string)).requestedBy).toBe("usr_sam");

    g.block("This project reached its monthly budget of $10.00.");
    const paused = (await w.orchestrator.drain(5)).find((s) => s.id === sessionId);
    expect(paused?.overBudget).toBe("This project reached its monthly budget of $10.00.");
    expect(paused?.machine.state).toBe("queued");
    expect(w.bus.log.filter((e) => e.type === "session.budget")).toHaveLength(1);
    expect(await w.orchestrator.budgetChanged()).toEqual([]);

    g.block(null);
    expect(await w.orchestrator.budgetChanged()).toEqual([sessionId]);
    const done = (await w.orchestrator.drain(50)).find((s) => s.id === sessionId);
    expect(done?.machine.state).toBe("merged");
    expect(done?.overBudget).toBeNull();
    expect(g.spent.length).toBeGreaterThan(0);
    expect(g.spent.every((s) => s.by === "usr_sam")).toBe(true);
  });
});
