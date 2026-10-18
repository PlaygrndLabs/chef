import { describe, expect, it } from "vitest";
import { templateTree, world } from "../harness.ts";
import { bootstrapTree, MENU_PATH, presets, promptFor, script } from "../scenarios/shared-menu.ts";

async function project() {
  const w = world({ script, presets: presets() });
  await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
  return w;
}

describe("versions of one feature", () => {
  it("runs a second version on its own branch, waits for a person while both are open, and archives the other one on merge", async () => {
    const w = await project();
    const first = (await w.orchestrator.submit(promptFor("notes"))).sessionId as string;
    await w.orchestrator.step(first);
    const second = await w.orchestrator.newVersion(first, "Try it with a two column layout");
    expect(second.featureId).toBe("notes");
    expect(second.version).toBe(2);
    expect((await w.orchestrator.session(first)).version).toBe(1);
    expect(second.fork).not.toBe((await w.orchestrator.session(first)).fork);
    expect(w.bus.log.some((e) => e.type === "session.versioned" && e.sessionId === second.id && e.from === first)).toBe(true);
    expect(w.bus.log.some((e) => e.type === "session.steered" && e.sessionId === second.id)).toBe(true);

    const held = await w.orchestrator.run(first);
    expect(held.machine.state).toBe("gating");
    expect(held.ready?.approved).toBe(false);
    const other = await w.orchestrator.run(second.id);
    expect(other.machine.state).toBe("gating");
    expect(other.ready?.approved).toBe(false);
    expect((await w.orchestrator.mainTree()).tree[MENU_PATH]).not.toContain('"notes",');

    await w.orchestrator.approveMerge(second.id);
    const picked = await w.orchestrator.run(second.id);
    expect(picked.machine.state).toBe("merged");
    const archived = await w.orchestrator.session(first);
    expect(archived.machine.state).toBe("dropped");
    expect(archived.machine.reason).toContain("version 2 was merged instead");
    expect((await w.orchestrator.mainTree()).tree[MENU_PATH]).toContain('"notes",');
  });

  it("merges on its own again once only one version is left", async () => {
    const w = await project();
    const first = (await w.orchestrator.submit(promptFor("notes"))).sessionId as string;
    await w.orchestrator.step(first);
    const second = await w.orchestrator.newVersion(first);
    await w.orchestrator.drop(second.id);
    expect((await w.orchestrator.run(first)).machine.state).toBe("merged");
    await expect(w.orchestrator.newVersion(first)).rejects.toThrow("ask for a change instead");
  });
});
