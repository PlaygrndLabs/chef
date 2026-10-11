import { describe, expect, it } from "vitest";
import { lintSpecFiles, parseFeature, renderFeature } from "../../src/spec/index.ts";
import { todoSpec } from "../harness.ts";

describe("spec", () => {
  it("round-trips a feature through markdown", () => {
    const parsed = parseFeature(renderFeature(todoSpec));
    expect(parsed).toEqual({ ok: true, spec: todoSpec });
  });

  it("reports schema, naming and duplicate problems", () => {
    const good = renderFeature(todoSpec);
    const { problems } = lintSpecFiles({
      "spec/features/todo-add.md": good,
      "spec/features/other.md": good,
      "spec/features/bad.md": "---\nid: bad\n---\n",
    });
    const messages = problems.map((p) => `${p.path}: ${p.message}`);
    expect(messages).toContain('spec/features/other.md: id "todo-add" must match file name "other"');
    expect(messages.some((m) => m.includes(": duplicate id \"todo-add\""))).toBe(true);
    expect(messages.some((m) => m.startsWith("spec/features/bad.md: title"))).toBe(true);
  });
});
