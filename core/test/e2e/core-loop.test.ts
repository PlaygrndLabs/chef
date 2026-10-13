import { describe, expect, it } from "vitest";
import { NOTES_NAMESPACE, PROOF_NAMESPACE, parseNote } from "../../src/notes/notes.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

describe("phase 1 core loop on fakes", () => {
  it("takes one prompt to canonical main with proof, notes and a preview from the first commit", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    const initial = await w.orchestrator.bootstrap(templateTree());
    const { decision, sessionId } = await w.orchestrator.submit(PROMPT);
    expect(decision.intent).toBe("new_feature");
    expect(sessionId).not.toBeNull();

    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");

    const mainHead = await w.repos.resolveRef("demo", "main");
    expect(mainHead).not.toBe(initial);
    const main = await w.repos.readCommit("demo", mainHead as string);
    expect(Object.keys(main?.tree ?? {})).toEqual(expect.arrayContaining(["features/todo-add/index.ts", "features/todo-add/todo-add.test.ts", "features/todo-add/flow.ts", "spec/features/todo-add.md"]));
    expect(main?.tree["src/registry.gen.ts"]).toContain('from "../features/todo-add/index.ts"');
    expect(readSpec(main?.tree ?? {}).find((f) => f.id === "todo-add")?.status).toBe("merged");

    const history = await w.repos.log("demo", "main", 100);
    const featureCommits = history.filter((c) => c.id !== initial);
    expect(featureCommits.length).toBeGreaterThanOrEqual(3);
    for (const commit of featureCommits) {
      const note = parseNote(await w.repos.readNote("demo", NOTES_NAMESPACE, commit.id));
      expect(note, `commit ${commit.message} has a note`).not.toBeNull();
      expect(note?.rootPrompt).toBe(PROMPT);
      expect(note?.feature).toBe("todo-add");
    }
    const roles = await Promise.all(featureCommits.map(async (c) => parseNote(await w.repos.readNote("demo", NOTES_NAMESPACE, c.id))?.role));
    expect(roles).toEqual(expect.arrayContaining(["planner", "test", "backend", "gardener"]));
    const started = w.bus.log.flatMap((e) => (e.type === "agent.started" ? [e.role] : []));
    expect([...new Set(started)]).toEqual(["planner", "test", "backend", "reviewer"]);

    expect(record.firstPreviewCommit).toBe(record.commits[0]);
    expect(w.previews.deployments[0]?.commitId).toBe(record.commits[0]);
    expect(w.bus.log.find((e) => e.type === "preview.updated")).toBeDefined();

    const proofCommit = w.proofs.proofs.at(-1)?.commitId as string;
    const proof = JSON.parse((await w.repos.readNote("demo", PROOF_NAMESPACE, proofCommit)) ?? "null");
    expect(proof.ok).toBe(true);
    expect(proof.steps.map((s: { name: string }) => s.name)).toEqual(["AC1: add an item", "AC2: see the item in the list", "AC3: an empty item is rejected"]);
  });

  it("never hands a coder a write token or any token for canonical main", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    await w.orchestrator.run(sessionId as string);
    const handed = new Set(w.coder.turns.map((t) => t.workspace.readToken));
    const tokens = w.repos.issued.filter((t) => handed.has(t.secret));
    expect(tokens.length).toBe(w.coder.turns.length);
    for (const token of tokens) {
      expect(token.scope).toBe("read");
      expect(token.repo).not.toBe("demo");
    }
  });

  it("reaches main three runs in a row with zero human actions", async () => {
    for (let run = 0; run < 3; run++) {
      const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
      await w.orchestrator.bootstrap(templateTree());
      const { sessionId } = await w.orchestrator.submit(PROMPT);
      expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");
    }
  });

  it("sends a failing gate back to the coder with the log and merges after the fix", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]) });
    await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "AC2 failed: expected two items");
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
    expect(record.machine.usage.attempts).toBe(2);
    const retry = w.coder.turns.filter((t) => t.role === "backend").at(-1);
    expect(retry?.prompt).toContain("AC2 failed: expected two items");
  });

  it("marks a feature stuck when the attempt budget runs out, without blocking anything", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), config: { budget: { maxAttempts: 2, maxTokens: 1e9, maxMillis: 1e12 } } });
    const initial = await w.orchestrator.bootstrap(templateTree());
    w.checks.failNext("test", "still red", 10);
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("stuck");
    expect(record.machine.reason).toMatch(/attempt budget/);
    expect(await w.repos.resolveRef("demo", "main")).toBe(initial);
    expect(w.bus.count("session.stuck")).toBe(1);
  });

  it("rejects a coder turn that writes outside its scope and never commits it", async () => {
    let first = true;
    const base = scriptFromFixture(fixture("todo"));
    const w = world({
      presets: new Map([[PROMPT, todoSpec]]),
      script: async (input, attempt) => {
        const result = await base(input, attempt);
        if (input.role === "backend" && first) {
          first = false;
          return { changes: { ...result.changes, "features/other/index.ts": "export const hacked = true;\n" } };
        }
        return result;
      },
    });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
    const main = await w.repos.readCommit("demo", (await w.repos.resolveRef("demo", "main")) as string);
    expect(main?.tree["features/other/index.ts"]).toBeUndefined();
    expect(w.coder.turns.filter((t) => t.role === "backend").at(-1)?.prompt).toContain("outside your write scope");
  });

  it("rejects comments in code through the lint check", async () => {
    const base = scriptFromFixture(fixture("todo"));
    let commented = true;
    const w = world({
      presets: new Map([[PROMPT, todoSpec]]),
      script: async (input, attempt) => {
        const result = await base(input, attempt);
        if (input.role !== "backend" || !commented) return result;
        commented = false;
        const path = "features/todo-add/index.ts";
        return { changes: { ...result.changes, [path]: `// adds todos\n${result.changes[path]}` } };
      },
    });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
    const gate = w.bus.log.find((e) => e.type === "gate.result" && !e.ok);
    expect(gate && gate.type === "gate.result" && gate.checks.find((c) => c.name === "lint")?.log).toContain("no-comments");
  });
});
