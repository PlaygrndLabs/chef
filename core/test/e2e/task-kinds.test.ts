import { describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, PROOF_NAMESPACE, parseNote } from "../../src/notes/notes.ts";
import { readSpec } from "../../src/spec/lint.ts";
import type { Script } from "../../src/fakes/scripted-coder.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { bootstrapTree, presets, promptFor, script as menuScript } from "../scenarios/shared-menu.ts";

const TODO = "Add an item to a todo list";
const README = "# demo\n\nRun `pnpm test` to check every feature.\n";

function choreScript(firstTry: Record<string, string> = { "README.md": README }): Script {
  const todo = scriptFromFixture(fixture("todo"));
  return (input, attempt) => {
    if (input.role !== "chore") return todo(input, attempt);
    return { changes: attempt === 1 ? firstTry : { "README.md": README }, summary: "Explain how to run the tests" };
  };
}

describe("chores and hotfixes", () => {
  it("runs a chore outside any feature folder and proves every live feature again", async () => {
    const w = world({ script: choreScript(), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const feature = await w.orchestrator.submit(TODO);
    expect((await w.orchestrator.run(feature.sessionId as string)).machine.state).toBe("merged");

    const chore = await w.orchestrator.submit("/chore Explain how to run the tests in the README");
    expect(chore.decision).toMatchObject({ intent: "chore", via: "rules" });
    expect(chore.featureId).toBe("chore-explain-how-run-tests");
    const record = await w.orchestrator.run(chore.sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(record.kind).toBe("chore");
    expect(record.plan.items.map((i) => [i.kind, i.role])).toEqual([["chore", "chore"]]);

    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(main?.tree["README.md"]).toBe(README);
    expect(readSpec(main?.tree ?? {}).map((f) => f.id)).not.toContain(record.featureId);
    const roles = w.bus.log.flatMap((e) => (e.type === "agent.started" && e.sessionId === record.id ? [e.role] : []));
    expect(roles).toEqual(["chore", "reviewer"]);
    const notes = await Promise.all(record.commits.map(async (id) => parseNote(await w.repos.readNote("demo", NOTES_NAMESPACE, id))));
    expect(notes.some((n) => n?.role === "chore" && n.kind === "chore")).toBe(true);
    const proof = JSON.parse((await w.repos.readNote("demo", PROOF_NAMESPACE, w.proofs.proofs.at(-1)?.commitId as string)) ?? "null");
    expect(proof).toMatchObject({ chore: record.featureId, ok: true });
    expect(proof.proofs.map((p: { feature: string }) => p.feature)).toEqual(readSpec(main?.tree ?? {}).filter((f) => f.status === "merged").map((f) => f.id));
    expect(proof.proofs.map((p: { feature: string }) => p.feature)).toContain("todo-add");
  });

  it("keeps a chore away from the locked feature tests", async () => {
    const w = world({ script: choreScript({ "features/todo-add/todo-add.test.ts": "export {};\n" }), presets: new Map([[TODO, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    await w.orchestrator.run((await w.orchestrator.submit(TODO)).sessionId as string);
    const chore = await w.orchestrator.submit("/chore Tidy the tests");
    expect((await w.orchestrator.run(chore.sessionId as string)).machine.state).toBe("merged");
    expect(w.bus.log.some((e) => e.type === "turn.rejected" && e.role === "chore" && e.rule === "write-scope" && e.paths.includes("features/todo-add/todo-add.test.ts"))).toBe(true);
  });

  it("lets a hotfix go live first while other builds wait at the final checks", async () => {
    const w = world({ script: menuScript, presets: presets(), config: { specialization: { attempts: 2 } } });
    await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
    const normal = await w.orchestrator.submit(promptFor("notes"));
    expect(normal.sessionIds).toHaveLength(2);
    const hotfix = await w.orchestrator.submit(`/hotfix ${promptFor("tags")}`);
    expect(hotfix.decision.hotfix).toBe(true);
    expect(hotfix.sessionIds).toHaveLength(1);
    expect((await w.orchestrator.session(hotfix.sessionId as string)).hotfix).toBe(true);

    for (let i = 0; i < 30; i++) for (const id of normal.sessionIds) await w.orchestrator.step(id);
    for (const id of normal.sessionIds) {
      const waiting = await w.orchestrator.session(id);
      expect(waiting.machine.state).toBe("gating");
      expect(waiting.heldBy).toBe(hotfix.sessionId);
    }
    expect(w.bus.log.some((e) => e.type === "session.held" && e.by === hotfix.sessionId)).toBe(true);
    expect(w.bus.log.some((e) => e.type === "main.merged")).toBe(false);

    const sessions = await w.orchestrator.drain(100);
    expect(sessions.find((s) => s.id === hotfix.sessionId)?.machine.state).toBe("merged");
    expect(sessions.filter((s) => s.featureId === "notes").map((s) => s.machine.state).sort()).toEqual(["dropped", "merged"]);
    const merged = w.bus.log.flatMap((e) => (e.type === "main.merged" ? [e.featureId] : []));
    expect(merged).toEqual(["tags", "notes"]);
    expect(w.bus.log.some((e) => e.type === "session.held" && e.by === null)).toBe(true);
  });
});
