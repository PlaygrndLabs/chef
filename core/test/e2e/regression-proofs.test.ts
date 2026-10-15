import { describe, expect, it } from "vitest";
import { templateTree, world } from "../harness.ts";
import { bootstrapTree, presets, promptFor, script } from "../scenarios/shared-menu.ts";

describe("proofs of merged features at the gate", () => {
  it("proves every merged feature again on a later feature's synced branch and sends it back when one breaks", async () => {
    const w = world({ script, presets: presets() });
    await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
    expect((await w.orchestrator.run((await w.orchestrator.submit(promptFor("notes"))).sessionId as string)).machine.state).toBe("merged");

    const tags = (await w.orchestrator.submit(promptFor("tags"))).sessionId as string;
    const fork = (await w.orchestrator.session(tags)).fork;
    w.proofs.failNext("notes", "signing the form showed an empty error box", 1, fork);
    const record = await w.orchestrator.run(tags);
    expect(record.machine.state).toBe("merged");

    const gates = w.bus.log.filter((e) => e.type === "gate.result" && e.sessionId === tags);
    expect(gates.map((g) => g.type === "gate.result" && g.ok)).toEqual([false, true]);
    const proof = gates[0]?.type === "gate.result" ? gates[0].checks.find((c) => c.name === "proof") : undefined;
    expect(proof?.ok).toBe(false);
    expect(proof?.log).toContain("FAIL notes drive: signing the form showed an empty error box");
    expect(w.proofs.proofs.filter((p) => p.feature === "notes" && p.commitId !== w.proofs.proofs.find((q) => q.feature === "notes")?.commitId)).toHaveLength(2);
  });
});
