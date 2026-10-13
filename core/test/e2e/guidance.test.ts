import { describe, expect, it } from "vitest";
import { AGENTS_FILE, GOAL_FILE } from "../../src/guidance/guidance.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";

describe("project instructions and memory on fakes", () => {
  it("gives every agent the shared instructions, the goal and the project's instructions", async () => {
    let shared = "Use plain CSS.";
    const w = world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[prompt, todoSpec]]), config: { instructions: async () => shared } });
    await w.orchestrator.bootstrap(templateTree());
    const saved = await w.orchestrator.editGuidance({ kind: "instructions", goal: "A todo list for a small team.", instructions: "Keep every page under one screen.", previous: { goal: "", instructions: "" } });
    expect(saved.ok).toBe(true);
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main[GOAL_FILE]).toBe("A todo list for a small team.\n");
    expect(main[AGENTS_FILE]).toBe("Keep every page under one screen.\n");
    shared = "Use plain CSS and no frameworks.";

    const { sessionId } = await w.orchestrator.submit(prompt);
    expect((await w.orchestrator.run(sessionId as string)).machine.state).toBe("merged");
    expect(w.planner.planned[0]?.guidance).toContain("A todo list for a small team.");
    const turn = w.coder.turns.find((t) => t.role === "backend");
    for (const text of [turn?.instructions, turn?.agent.prompt]) {
      expect(text).toContain("Use plain CSS and no frameworks.");
      expect(text).toContain("A todo list for a small team.");
      expect(text).toContain("Keep every page under one screen.");
    }
  });

  it("adds, edits and removes memory on main and re-indexes it", async () => {
    const w = world({ script: scriptFromFixture(fixture("todo")) });
    await w.orchestrator.bootstrap(templateTree());
    const added = await w.orchestrator.editGuidance({ kind: "note", title: "Prices are in euros", text: "Show prices with the € sign." });
    expect(added).toMatchObject({ ok: true, path: "memory/notes/prices-are-in-euros.md" });
    expect((await w.deps.memory.query("euros prices", 3)).map((h) => h.doc.path)).toContain("memory/notes/prices-are-in-euros.md");
    const edited = await w.orchestrator.editGuidance({ kind: "memory", path: "memory/notes/prices-are-in-euros.md", text: "# Prices are in dollars\n\nShow $.", previous: "# Prices are in euros\n\nShow prices with the € sign." });
    expect(edited.ok).toBe(true);
    expect((await w.orchestrator.mainTree()).tree["memory/notes/prices-are-in-euros.md"]).toContain("Prices are in dollars");
    const removed = await w.orchestrator.editGuidance({ kind: "memory", path: "memory/notes/prices-are-in-euros.md", text: null, previous: "# Prices are in dollars\n\nShow $." });
    expect(removed.ok).toBe(true);
    expect((await w.deps.memory.query("dollars prices", 3)).map((h) => h.doc.path)).not.toContain("memory/notes/prices-are-in-euros.md");
    const log = await w.repos.log("demo", "main", 10);
    expect(log.slice(0, 3).map((c) => c.message)).toEqual(["memory: remove memory/notes/prices-are-in-euros.md", "memory: edit memory/notes/prices-are-in-euros.md", "memory: add memory/notes/prices-are-in-euros.md"]);
  });
});
