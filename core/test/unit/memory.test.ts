import { describe, expect, it } from "vitest";
import { projectRuleProblems, renderRule, rulePath } from "../../src/checks/project-rules.ts";
import { featureMapProblems, gardenFeatureMap, lineRegex, mineRules, normalizeLine, type Correction } from "../../src/gardener/gardener.ts";
import { LexicalIndex } from "../../src/fakes/lexical-index.ts";
import { lessonPath, memoryDocs, renderFeatureMemory, renderLesson, renderRecall } from "../../src/memory/memory.ts";
import { readSpec } from "../../src/spec/lint.ts";
import { renderFeature } from "../../src/spec/parse.ts";
import type { FeatureSpec } from "../../src/spec/schema.ts";

const feature: FeatureSpec = {
  id: "reverse",
  title: "Reverse a text",
  status: "merged",
  entrypoint: "POST /reverse",
  revision: 1,
  shared: [],
  acceptance: [
    { id: "AC1", text: "POST /reverse returns the characters in reverse order" },
    { id: "AC2", text: "emoji stay intact" },
  ],
  body: "Reverse a text.",
};

const vacuous = (value: string) => `import assert from "node:assert/strict";
import { test } from "node:test";

test("AC1: works", async () => {
  assert.equal(1, 1);
});

test("AC2: edge", () => {
  assert.deepEqual(${JSON.stringify(value)}, ${JSON.stringify(value)});
});
`;

const good = `test("AC2: edge", async () => {
  const { result } = await call("x");
  assert.deepEqual(result, "X");
});
`;

function correction(sessionId: string, value: string, signature = "red-tests"): Correction {
  return {
    id: `c-${sessionId}`,
    featureId: sessionId,
    sessionId,
    role: "test",
    signature,
    before: { [`features/${sessionId}/${sessionId}.test.ts`]: vacuous(value) },
    after: { [`features/${sessionId}/${sessionId}.test.ts`]: good },
    passing: ["AC2: edge"],
  };
}

describe("project memory", () => {
  it("reads memory files with frontmatter and spec entries as documents", () => {
    const lesson = renderLesson({ feature, featureId: "reverse", mergedCommit: "0123456789abcdef", log: "not ok monitor reverse #2", prompts: ["Reverse a text via POST /reverse"] });
    const tree = { [lessonPath("reverse", "0123456789abcdef")]: lesson, "memory/notes/style.md": "Prefer small features.", "spec/features/reverse.md": renderFeature(feature), "src/app.ts": "" };
    const docs = memoryDocs(tree);
    expect(docs.map((d) => [d.path, d.kind, d.feature])).toEqual([
      ["memory/lessons/reverse-0123456789ab.md", "lesson", "reverse"],
      ["memory/notes/style.md", "note", null],
      ["spec/features/reverse.md", "spec", "reverse"],
    ]);
    expect(docs[0]?.text).toContain("not ok monitor reverse #2");
    expect(docs[0]?.text).not.toContain("kind: lesson");
  });

  it("keeps earlier sessions when it condenses a new one into the feature memory", () => {
    const summary = { feature, sessionId: "s1", parent: null, rootPrompt: "Reverse a text", attempt: { index: 1, of: 1 }, turns: [{ role: "backend", message: "code(reverse): first" }], feedback: ["Main went red after merging"] };
    const first = renderFeatureMemory(undefined, summary);
    const second = renderFeatureMemory(first, { ...summary, sessionId: "s2", parent: "s1", feedback: [] });
    expect(second).toContain("### s1");
    expect(second).toContain("### s2 (follows s1)");
    expect(second).toContain("- Main went red after merging");
    expect(second.match(/## Sessions/g)).toHaveLength(1);
  });

  it("ranks the lexical index by shared terms and filters by kind", async () => {
    const index = new LexicalIndex();
    await index.upsert([
      { path: "memory/lessons/reverse-1.md", kind: "lesson", feature: "reverse", text: "emoji split into surrogate halves when reversed" },
      { path: "memory/features/slug.md", kind: "feature", feature: "slug", text: "slug joins words with dashes" },
      { path: "spec/features/reverse.md", kind: "spec", feature: "reverse", text: "reverse a text" },
    ]);
    const hits = await index.query("reverse emoji text", 5, ["lesson", "feature"]);
    expect(hits.map((h) => h.doc.path)).toEqual(["memory/lessons/reverse-1.md"]);
    await index.remove(["memory/lessons/reverse-1.md"]);
    expect(await index.query("emoji", 5)).toEqual([]);
    expect(renderRecall([])).toBe("");
  });
});

describe("gardener", () => {
  it("adds spec entries for feature folders that have none, using test names as criteria", () => {
    const tree = { "features/shout/index.ts": "export const feature = {};", "features/shout/shout.test.ts": 'test("AC1: shouts", () => {});\ntest(\'AC2: trims\', () => {});' };
    expect(featureMapProblems(tree)).toEqual(["features/shout has no spec entry"]);
    const changes = gardenFeatureMap(tree);
    const garden = readSpec({ ...tree, ...(changes as Record<string, string>) });
    expect(garden.map((f) => [f.id, f.status, f.acceptance.map((c) => c.id)])).toEqual([["shout", "merged", ["AC1", "AC2"]]]);
    expect(featureMapProblems({ ...tree, ...(changes as Record<string, string>) })).toEqual([]);
    expect(featureMapProblems({ "spec/features/reverse.md": renderFeature(feature) })).toEqual(["spec reverse is merged but features/reverse/index.ts is missing"]);
  });

  it("generalizes literals so the same mistake with different values matches one rule", () => {
    const normalized = normalizeLine('  assert.deepEqual("HI!", "HI!");');
    const regex = new RegExp(lineRegex(normalized));
    expect(regex.test("assert.deepEqual(3, 3);")).toBe(true);
    expect(regex.test('    assert.deepEqual( "a-b" , "a-b" );')).toBe(true);
    expect(regex.test('assert.deepEqual(result, "HI!");')).toBe(false);
  });

  it("mines a rule only after the same correction appears in enough sessions", () => {
    expect(mineRules([correction("shout", "HI!"), correction("slug", "a-b")], {})).toEqual([]);
    const mined = mineRules([correction("shout", "HI!"), correction("slug", "a-b"), correction("word-count", "0")], {});
    expect(mined).toHaveLength(1);
    const [{ rule, sessions }] = mined as [(typeof mined)[number]];
    expect(sessions).toEqual(["shout", "slug", "word-count"]);
    expect(rule.files).toBe("**/*.test.ts");
    expect(rule.source).toBe("red-tests");
    expect(rule.evidence).toEqual(["c-shout", "c-slug", "c-word-count"]);
    expect(mineRules([correction("shout", "HI!"), correction("slug", "a-b"), correction("word-count", "0")], { [rulePath(rule.id)]: renderRule(rule) })).toEqual([]);
  });

  it("does not mine new rules from turns an existing project rule already rejected", () => {
    const enforced = [correction("shout", "HI!", "project-lint"), correction("slug", "a-b", "project-lint"), correction("word-count", "0", "project-lint")];
    expect(mineRules(enforced, {})).toEqual([]);
  });

  it("does not mine a line that accepted code or the current tree still uses", () => {
    const corrections = [correction("shout", "HI!"), correction("slug", "a-b"), correction("word-count", "0")];
    const accepted = corrections.map((c, i) => (i === 0 ? { ...c, after: { "features/shout/shout.test.ts": vacuous("ok") } } : c));
    expect(mineRules(accepted, {})).toEqual([]);
    expect(mineRules(corrections, { "features/old/old.test.ts": vacuous("kept") })).toEqual([]);
  });

  it("reports project rule violations with path and line", () => {
    const rule = mineRules([correction("shout", "HI!"), correction("slug", "a-b"), correction("word-count", "0")], {})[0]?.rule;
    if (!rule) throw new Error("no rule mined");
    const tree = { [rulePath(rule.id)]: renderRule(rule), "features/vowels/vowels.test.ts": vacuous("3"), "features/vowels/index.ts": 'assert.deepEqual(1, 1);' };
    const problems = projectRuleProblems(tree);
    expect(problems).toEqual([{ rule: "project-rules", id: rule.id, path: "features/vowels/vowels.test.ts", line: 9, message: `${rule.message} [${rule.id}]` }]);
  });
});
