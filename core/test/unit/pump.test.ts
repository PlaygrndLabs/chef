import { describe, expect, it } from "vitest";
import type { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { SessionPump } from "../../src/orchestrator/pump.ts";
import type { SessionRecord } from "../../src/session/record.ts";

function session(id: string, state: string): SessionRecord {
  return { id, machine: { state } } as unknown as SessionRecord;
}

describe("the session pump", () => {
  it("keeps stepping other sessions while one session's step is still running", async () => {
    const steps: string[] = [];
    let finishGate = (): void => {};
    const records = [session("parent", "gating"), session("child", "queued"), session("old", "merged")];
    const orchestrator = {
      sessions: async () => records,
      step: (id: string) => {
        steps.push(id);
        return id === "parent" ? new Promise<void>((resolve) => (finishGate = resolve)) : Promise.resolve();
      },
    } as unknown as Orchestrator;
    const pump = new SessionPump();
    const settled: string[] = [];
    for (let round = 0; round < 3; round++) {
      await pump.kick(orchestrator, (id) => settled.push(id));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(steps).toEqual(["parent", "child", "child", "child"]);
    expect(pump.busy()).toBe(true);
    finishGate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled.at(-1)).toBe("parent");
    expect(pump.busy()).toBe(false);
  });
});
