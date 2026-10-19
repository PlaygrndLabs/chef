import { describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, parseNote } from "../../src/notes/notes.ts";
import { readSpec } from "../../src/spec/lint.ts";
import type { ChefEvent } from "../../src/events/events.ts";
import { FakeCheckRunner } from "../../src/fakes/fake-checks.ts";
import type { CheckResult } from "../../src/ports/check-runner.ts";
import type { Tree } from "../../src/git/tree.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { bootstrapTree, FEATURES, MENU_PATH, presets, promptFor, script } from "../scenarios/shared-menu.ts";

function counts(log: readonly ChefEvent[]): Record<string, number> {
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
    expect(events["app.updated"] ?? 0).toBeLessThanOrEqual(120);
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
    const lessons = Object.keys(revertTree).filter((path) => path.startsWith("memory/lessons/todo-add-"));
    expect(lessons).toHaveLength(1);
    expect(Object.fromEntries(Object.entries(revertTree).filter(([path]) => !lessons.includes(path)))).toEqual((await w.repos.readCommit("demo", initial))?.tree);
    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(main?.tree["features/todo-add/index.ts"]).toBeDefined();
    expect(readSpec(main?.tree ?? {}).find((f) => f.id === "todo-add")?.status).toBe("merged");
    expect(w.bus.log.length).toBeLessThan(150);
  });

  it("marks a session merged before main's checks run, and reverts it when they turn red afterwards", async () => {
    const prompt = "Add an item to a todo list";
    const queued: (() => Promise<void>)[] = [];
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), deps: { background: (work) => void queued.push(work) } });
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed on main: list order differs", 1, "demo");
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(w.checks.runs.filter((r) => r.repo === "demo")).toEqual([]);
    expect(counts(w.bus.log)["main.reverted"]).toBeUndefined();

    expect(await w.orchestrator.verifyMerges()).toBe(1);
    while (queued.length) await (queued.shift() as () => Promise<void>)();
    expect(await w.orchestrator.verifyMerges()).toBe(0);
    expect(w.checks.runs.filter((r) => r.repo === "demo").map((r) => r.commitId)).toContain(record.merge?.commitId);
    expect(counts(w.bus.log)["main.reverted"]).toBe(1);
    expect((await w.orchestrator.session(sessionId as string)).machine.state).toBe("coding");
  });

  it("merges without gating again when main moved only in files the session did not change", async () => {
    const prompt = "Add an item to a todo list";
    let onGate: (() => Promise<void>) | null = null;
    const inner = new FakeCheckRunner();
    const forkRuns: string[] = [];
    const checks = {
      async run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]> {
        if (input.repo !== "demo") forkRuns.push(input.commitId);
        const hook = onGate;
        if (hook && input.repo !== "demo") {
          onGate = null;
          await hook();
        }
        return inner.run(input);
      },
    };
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), deps: { checks } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    let gated = 0;
    for (let i = 0; i < 100; i++) {
      const record = await w.orchestrator.session(sessionId as string);
      if (record.machine.state === "merged") break;
      if (record.machine.state === "gating" && !gated) {
        gated = forkRuns.length + 1;
        onGate = async () => {
          const head = (await w.repos.resolveRef("demo", "main")) as string;
          const token = await w.repos.createToken("demo", "write", 900);
          await w.repos.commit(token, { ref: "main", parent: head, changes: { "docs/elsewhere.md": "another change\n" }, message: "Another merge", author: { name: "chef", email: "ma.karimi76@gmail.com" } });
        };
      }
      await w.orchestrator.step(sessionId as string);
    }

    const record = await w.orchestrator.session(sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(gated).toBeGreaterThan(0);
    expect(forkRuns.length).toBe(gated);
    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(main?.tree["docs/elsewhere.md"]).toBe("another change\n");
    expect(main?.tree["features/todo-add/index.ts"]).toBeDefined();
  });
});
