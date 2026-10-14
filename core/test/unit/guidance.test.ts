import { describe, expect, it } from "vitest";
import { AGENTS_FILE, applyGuidanceEdit, GOAL_FILE, learnedRules, memoryEntries, projectGuidance, renderGuidance } from "../../src/guidance/guidance.ts";

const lesson = "---\nkind: lesson\nfeature: todo-add\n---\n\n# todo-add: a merge was reverted\n\nCheck the order.\n";

describe("project instructions and memory", () => {
  it("renders nothing when no instructions are set", () => {
    expect(renderGuidance("", { goal: "", instructions: "" })).toBe("");
  });

  it("puts the shared instructions, the goal and the project's instructions in one block", () => {
    const text = renderGuidance("Use Tailwind.", { goal: "A family shopping list.", instructions: "Mobile first." });
    expect(text).toContain("## Instructions for every project\n\nUse Tailwind.");
    expect(text).toContain(`## This project's goal (${GOAL_FILE})\n\nA family shopping list.`);
    expect(text).toContain(`## This project's instructions (${AGENTS_FILE})\n\nMobile first.`);
    expect(text).toContain("follow this project's");
    expect(text.indexOf("every project")).toBeLessThan(text.indexOf("Mobile first."));
    expect(renderGuidance("", { goal: "A list.", instructions: "" })).not.toContain("disagree");
  });

  it("writes GOAL.md and AGENTS.md, removes them when emptied, and refuses a stale edit", () => {
    const created = applyGuidanceEdit({}, { kind: "instructions", goal: " A list. ", instructions: "Be brief.", previous: { goal: "", instructions: "" } });
    expect(created).toMatchObject({ ok: true, changes: { [GOAL_FILE]: "A list.\n", [AGENTS_FILE]: "Be brief.\n" } });
    const tree = { [GOAL_FILE]: "A list.\n", [AGENTS_FILE]: "Be brief.\n" };
    expect(projectGuidance(tree)).toEqual({ goal: "A list.", instructions: "Be brief." });
    expect(applyGuidanceEdit(tree, { kind: "instructions", goal: "A list.", instructions: "", previous: { goal: "A list.", instructions: "Be brief." } })).toMatchObject({ ok: true, changes: { [AGENTS_FILE]: null } });
    expect(applyGuidanceEdit(tree, { kind: "instructions", goal: "Other", instructions: "", previous: { goal: "", instructions: "" } })).toMatchObject({ ok: false, status: 409 });
  });

  it("lists memory files, edits their text but keeps their frontmatter, and removes them", () => {
    const tree = { "memory/lessons/todo-add-0123.md": lesson, "memory/notes/euros.md": "---\nkind: note\n---\n\n# Prices are in euros\n\nShow €.\n", "src/app.ts": "" };
    expect(memoryEntries(tree).map((e) => [e.path, e.kind, e.feature, e.title])).toEqual([
      ["memory/lessons/todo-add-0123.md", "lesson", "todo-add", "todo-add: a merge was reverted"],
      ["memory/notes/euros.md", "note", null, "Prices are in euros"],
    ]);
    const previous = memoryEntries(tree)[0]?.text ?? "";
    const edited = applyGuidanceEdit(tree, { kind: "memory", path: "memory/lessons/todo-add-0123.md", text: "# todo-add\n\nKeep the order stable.", previous });
    expect(edited).toMatchObject({ ok: true, changes: { "memory/lessons/todo-add-0123.md": "---\nkind: lesson\nfeature: todo-add\n---\n\n# todo-add\n\nKeep the order stable.\n" } });
    expect(applyGuidanceEdit(tree, { kind: "memory", path: "memory/notes/euros.md", text: null, previous: "# Prices are in euros\n\nShow €." })).toMatchObject({ ok: true, changes: { "memory/notes/euros.md": null } });
    expect(applyGuidanceEdit(tree, { kind: "memory", path: "memory/notes/euros.md", text: "x", previous: "old" })).toMatchObject({ ok: false, status: 409 });
    expect(applyGuidanceEdit(tree, { kind: "memory", path: "src/app.ts", text: "x", previous: "" })).toMatchObject({ ok: false, status: 400 });
    expect(applyGuidanceEdit(tree, { kind: "memory", path: "memory/../src/app.md", text: "x", previous: "" })).toMatchObject({ ok: false, status: 400 });
  });

  it("adds a note under a fresh path", () => {
    const tree = { "memory/notes/prices-are-in-euros.md": "x" };
    const added = applyGuidanceEdit(tree, { kind: "note", title: "Prices are in euros!", text: "Show €." });
    expect(added).toMatchObject({ ok: true, path: "memory/notes/prices-are-in-euros-2.md", changes: { "memory/notes/prices-are-in-euros-2.md": "---\nkind: note\n---\n\n# Prices are in euros!\n\nShow €.\n" } });
    expect(applyGuidanceEdit(tree, { kind: "note", title: " ", text: "x" })).toMatchObject({ ok: false, status: 400 });
  });

  it("lists the lint rules Chef learned in the project", () => {
    const rule = { id: "no-inline-style", message: "Use the UI kit classes instead of inline styles.", files: "src/**/*.tsx", forbid: "style=\\{", source: "gardener", evidence: ["s1", "s2"] };
    const tree = { "lint/rules/no-inline-style.json": JSON.stringify(rule), "lint/rules/broken.json": "{", "memory/notes/a.md": "x" };
    expect(learnedRules(tree)).toEqual([{ id: "no-inline-style", path: "lint/rules/no-inline-style.json", message: rule.message, files: "src/**/*.tsx" }]);
  });
});
