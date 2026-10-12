import { describe, expect, it } from "vitest";
import { RuleReviewer, type Script } from "../../src/fakes/index.ts";
import { NOTES_NAMESPACE, renderNote, type TurnNote } from "../../src/notes/notes.ts";
import type { ReviewInput, ReviewVerdict } from "../../src/ports/reviewer.ts";
import type { SessionRecord } from "../../src/session/record.ts";
import type { ChefEvent } from "../../src/events/events.ts";
import { fixture, profiles, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";
import { bootstrapTree, FEATURES, MENU_PATH, presets, promptFor, script as menuScript } from "../scenarios/shared-menu.ts";

const prompt = "Add an item to a todo list";
const todo = fixture("todo");
const TEST_PATH = "features/todo-add/todo-add.test.ts";
const INDEX_PATH = "features/todo-add/index.ts";

function todoWorld(script: Script, extra: Omit<Parameters<typeof world>[0], "script"> = {}) {
  return world({ script, presets: new Map([[prompt, todoSpec]]), ...extra });
}

function ofType<T extends ChefEvent["type"]>(log: readonly ChefEvent[], type: T): Extract<ChefEvent, { type: T }>[] {
  return log.filter((e): e is Extract<ChefEvent, { type: T }> => e.type === type);
}

const broadBackend = () => {
  const base = profiles();
  const backend = base["backend"];
  if (!backend) throw new Error("no backend profile");
  return { ...base, backend: { ...backend, writeScope: ["features/{feature}/**", "src/registry.gen.ts"] } };
};

describe("phase 3 specialization on fakes", () => {
  it("rejects a coder turn that edits a locked test even when its write scope allows it", async () => {
    const base = scriptFromFixture(todo);
    const script: Script = async (input, attempt) => {
      const out = await base(input, attempt);
      if (input.role === "backend" && attempt === 1) return { ...out, changes: { ...out.changes, [TEST_PATH]: "import { test } from \"node:test\";\n\ntest(\"AC1: weakened\", () => {});\n" } };
      return out;
    };
    const w = todoWorld(script, { config: { profiles: broadBackend() } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const rejected = ofType(w.bus.log, "turn.rejected");
    expect(rejected.map((e) => [e.role, e.rule, e.paths])).toEqual([["backend", "locked-tests", [TEST_PATH]]]);
    const retry = w.coder.turns.filter((t) => t.role === "backend").at(-1);
    expect(retry?.prompt).toContain("locked");
    const main = await w.orchestrator.mainTree();
    expect(main.tree[TEST_PATH]).toBe(todo[TEST_PATH]);
  });

  it("sends a review that finds missing tests back to the test writer, not the coder", async () => {
    const base = scriptFromFixture(todo);
    const full = todo[TEST_PATH] as string;
    const script: Script = async (input, attempt) => {
      const out = await base(input, attempt);
      if (input.role === "test" && attempt === 1) return { ...out, changes: { ...out.changes, [TEST_PATH]: full.slice(0, full.indexOf('test("AC3')) } };
      return out;
    };
    const w = todoWorld(script);
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const states = ofType(w.bus.log, "session.state").map((e) => `${e.from}->${e.to}`);
    expect(states).toContain("reviewing->testing");
    const testTurns = w.coder.turns.filter((t) => t.role === "test");
    expect(testTurns).toHaveLength(2);
    expect(testTurns[1]?.prompt).toContain("no test named after AC3");
    expect(ofType(w.bus.log, "turn.rejected")).toEqual([]);
    expect((await w.orchestrator.mainTree()).tree[TEST_PATH]).toBe(full);
  });

  it("fails the gate when a commit changed a locked test, reading roles from git notes", async () => {
    const w = todoWorld(scriptFromFixture(todo));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const id = sessionId as string;
    while ((await w.orchestrator.session(id)).machine.state !== "gating") await w.orchestrator.step(id);

    const record = await w.orchestrator.session(id);
    const token = await w.repos.createToken(record.fork, "write", 60);
    const sneaky = await w.repos.commit(token, { ref: "main", parent: record.head, changes: { [TEST_PATH]: "export {};\n" }, message: "code(todo-add): simplify", author: { name: "chef", email: "ma.karimi76@gmail.com" } });
    const note: TurnNote = { chef: 1, project: "demo", feature: "todo-add", session: id, role: "backend", kind: "code", workItem: null, prompt: "x", rootPrompt: prompt, runId: "r", model: "coder-default", specRevision: 1, paths: [TEST_PATH] };
    await w.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: sneaky.id, note: renderNote(note) });
    await w.repos.revokeToken(token);
    const updated: SessionRecord = { ...record, head: sneaky.id, commits: [...record.commits, sneaky.id] };
    await w.deps.store.put(`session/${id}`, updated);

    await w.orchestrator.step(id);
    const gate = ofType(w.bus.log, "gate.result").at(-1);
    expect(gate?.ok).toBe(false);
    const locked = gate?.checks.find((c) => c.name === "locked-tests");
    expect(locked?.ok).toBe(false);
    expect(locked?.log).toContain("(backend) changed locked tests: features/todo-add/todo-add.test.ts");
    expect(ofType(w.bus.log, "main.merged")).toEqual([]);
  });

  it("never merges when the reviewer runs on the coder's model", async () => {
    class SameModelReviewer extends RuleReviewer {
      override readonly model = "coder-default";
      override async review(input: ReviewInput): Promise<ReviewVerdict> {
        return { ...(await super.review(input)), model: this.model };
      }
    }
    const w = todoWorld(scriptFromFixture(todo), { deps: { reviewer: new SameModelReviewer() } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("stuck");
    expect(ofType(w.bus.log, "main.merged")).toEqual([]);
    const review = ofType(w.bus.log, "gate.result")[0]?.checks.find((c) => c.name === "review");
    expect(review?.log).toContain("same model that wrote the code");
  });

  it("runs parallel attempts on separate forks and merges only the one the reviewer picks", async () => {
    const base = scriptFromFixture(todo);
    const script: Script = async (input, attempt) => {
      const out = await base(input, attempt);
      if (input.role !== "backend" || input.attempt.index !== 1) return out;
      const padded = `${out.changes[INDEX_PATH] ?? ""}\nexport const padding: readonly number[] = [\n  1,\n  2,\n  3,\n];\n`;
      return { ...out, changes: { ...out.changes, [INDEX_PATH]: padded } };
    };
    const w = todoWorld(script);
    await w.orchestrator.bootstrap(templateTree());
    const { sessionIds } = await w.orchestrator.submit(prompt, { attempts: 2 });
    expect(sessionIds).toHaveLength(2);
    const sessions = await w.orchestrator.drain(60);

    const [first, second] = sessionIds as [string, string];
    const byId = new Map(sessions.map((s) => [s.id, s]));
    expect(byId.get(first)?.machine.state).toBe("dropped");
    expect(byId.get(second)?.machine.state).toBe("merged");
    expect(new Set(sessions.map((s) => s.fork)).size).toBe(2);
    const picked = ofType(w.bus.log, "attempt.picked");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.winner).toBe(second);
    expect(picked[0]?.candidates.map((c) => c.sessionId).sort()).toEqual([first, second].sort());
    expect(ofType(w.bus.log, "main.merged").map((e) => e.sessionId)).toEqual([second]);
    expect(w.coder.turns.filter((t) => t.role === "backend").map((t) => t.attempt)).toEqual(expect.arrayContaining([{ index: 1, of: 2 }, { index: 2, of: 2 }]));
    const main = await w.orchestrator.mainTree();
    expect(main.tree[INDEX_PATH]).toBe(todo[INDEX_PATH]);
    expect(await w.repos.resolveRef("demo", "preview/todo-add")).toBe(byId.get(second)?.head);
  });

  it("reverts one merge later without undoing an unrelated merge after it", async () => {
    const todoScript = scriptFromFixture(todo);
    const script: Script = (input, attempt) => (input.featureId === "todo-add" ? todoScript(input, attempt) : menuScript(input, attempt));
    const w = world({ script, presets: new Map([...presets(), [prompt, todoSpec]]) });
    await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
    const todoRun = await w.orchestrator.run((await w.orchestrator.submit(prompt)).sessionId as string);
    const notesRun = await w.orchestrator.run((await w.orchestrator.submit(promptFor("notes"))).sessionId as string);
    expect([todoRun.machine.state, notesRun.machine.state]).toEqual(["merged", "merged"]);

    const revertId = await w.orchestrator.revertMerge(todoRun.merge?.commitId as string, "monitor: todo list is down");
    expect(revertId).not.toBeNull();
    const main = await w.orchestrator.mainTree();
    expect(main.tree[INDEX_PATH]).toBeUndefined();
    expect(main.tree["features/notes/index.ts"]).toBeDefined();
    expect(main.tree[MENU_PATH]).toContain('"notes",');
    expect((await w.orchestrator.session(notesRun.id)).machine.state).toBe("merged");
    expect((await w.orchestrator.session(todoRun.id)).machine.state).toBe("coding");
  });

  it("returns main to before a merge and reopens later merges when reverting it alone conflicts", async () => {
    const w = world({ script: menuScript, presets: presets() });
    await w.orchestrator.bootstrap(bootstrapTree(templateTree()));
    for (const id of FEATURES) await w.orchestrator.submit(promptFor(id));
    await w.orchestrator.drain(100);
    const merges = ofType(w.bus.log, "main.merged");
    expect(merges).toHaveLength(3);
    const firstMerge = merges[0];
    if (!firstMerge) throw new Error("no merge");

    const revertId = await w.orchestrator.revertMerge(firstMerge.commitId, "monitor: page is down");
    expect(revertId).not.toBeNull();
    const reverted = await w.orchestrator.mainTree();
    for (const id of FEATURES) expect(reverted.tree[`features/${id}/index.ts`]).toBeUndefined();
    const reopened = (await w.orchestrator.sessions()).filter((s) => s.machine.state === "coding");
    expect(reopened).toHaveLength(3);
    expect(reopened.filter((s) => s.featureId !== firstMerge.featureId).every((s) => (s.machine.feedback ?? "").includes("reverting it alone conflicted"))).toBe(true);

    const final = await w.orchestrator.drain(100);
    expect(final.map((s) => s.machine.state)).toEqual(["merged", "merged", "merged"]);
    const main = await w.orchestrator.mainTree();
    for (const id of FEATURES) expect(main.tree[MENU_PATH]).toContain(`"${id}",`);
  });
});
