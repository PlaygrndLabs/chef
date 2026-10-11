import { describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, parseNote } from "../../src/notes/notes.ts";
import { readSpec } from "../../src/spec/lint.ts";
import type { KargahEvent } from "../../src/events/events.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { bootstrapTree, FEATURES, MENU_PATH, presets, promptFor, script } from "../scenarios/shared-menu.ts";

function counts(log: readonly KargahEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of log) out[event.type] = (out[event.type] ?? 0) + 1;
  return out;
}

describe("phase 2 concurrency on fakes", () => {
  it("merges three parallel features that edit the same shared file with no human step", async () => {
    const w = world({ script, presets: presets() });
    await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
    for (const id of FEATURES) expect((await w.orchestrator.submit(promptFor(id))).sessionId).not.toBeNull();

    const sessions = await w.orchestrator.drain(100);
    expect(sessions.map((s) => [s.featureId, s.machine.state])).toEqual(FEATURES.map((id) => [id, "merged"]));

    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    const menu = main?.tree[MENU_PATH] ?? "";
    for (const id of ["home", ...FEATURES]) expect(menu).toContain(`"${id}",`);
    expect(menu).not.toContain("<<<<<<<");
    for (const id of FEATURES) expect(readSpec(main?.tree ?? {}).find((f) => f.id === id)?.status).toBe("merged");

    const events = counts(w.bus.log);
    expect(events["sync.conflict"] ?? 0).toBeGreaterThan(0);
    expect(w.coder.turns.some((t) => t.role === "conflict-resolver")).toBe(true);
    expect(events["main.merged"]).toBe(3);
    expect(events["session.stuck"]).toBeUndefined();
    expect(events["sync.merged"] ?? 0).toBeLessThanOrEqual(FEATURES.length * FEATURES.length);
    expect(events["preview.updated"] ?? 0).toBeLessThanOrEqual(60);
    expect(w.bus.log.length).toBeLessThan(400);

    for (const commit of await w.repos.log("demo", "main", 500)) {
      if (commit.parents.length === 0) continue;
      expect(parseNote(await w.repos.readNote("demo", NOTES_NAMESPACE, commit.id)), commit.message).not.toBeNull();
    }
  });

  it("reverts a merge that turns main red and reopens its session until it merges again", async () => {
    const prompt = "Add an item to a todo list";
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]) });
    const initial = await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed on main: list order differs", 1, "demo");
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const events = counts(w.bus.log);
    expect(events["main.merged"]).toBe(2);
    expect(events["main.reverted"]).toBe(1);
    const reverted = w.bus.log.find((e) => e.type === "main.reverted");
    expect(reverted?.type === "main.reverted" && reverted.log).toContain("AC2 failed on main");
    const reopened = w.bus.log.find((e) => e.type === "session.state" && e.from === "merged" && e.to === "coding");
    expect(reopened).toBeDefined();
    const retry = w.coder.turns.filter((t) => t.role === "backend").at(-1);
    expect(retry?.prompt).toContain("AC2 failed on main");

    const history = await w.repos.log("demo", "main", 200);
    const revert = history.find((c) => c.message.startsWith("Revert todo-add"));
    expect(revert).toBeDefined();
    const revertTree = (await w.repos.readCommit("demo", revert?.id as string))?.tree ?? {};
    expect(revertTree).toEqual((await w.repos.readCommit("demo", initial))?.tree);
    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(main?.tree["features/todo-add/index.ts"]).toBeDefined();
    expect(readSpec(main?.tree ?? {}).find((f) => f.id === "todo-add")?.status).toBe("merged");
    expect(w.bus.log.length).toBeLessThan(150);
  });
});
