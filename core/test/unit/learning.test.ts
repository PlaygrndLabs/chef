import { describe, expect, it } from "vitest";
import type { ChefEvent } from "../../src/events/events.ts";
import { reviewPoints, toJsonl } from "../../src/learning/export.ts";
import { gemmaPrompt, parseReviewAnswer, reviewMessages, reviewTarget } from "../../src/learning/review-prompt.ts";
import type { FeatureSpec } from "../../src/spec/schema.ts";

const feature: FeatureSpec = {
  id: "shout",
  title: "Shout a phrase",
  status: "building",
  entrypoint: "POST /shout",
  revision: 1,
  shared: [],
  acceptance: [
    { id: "AC1", text: "POST /shout uppercases the value" },
    { id: "AC2", text: "surrounding whitespace is trimmed" },
  ],
  body: "Shout.",
};

const at = { project: "demo", at: 0 };

function verdict(sessionId: string, head: string, approve = true): ChefEvent {
  return { ...at, type: "review.verdict", sessionId, featureId: "shout", approve, reasons: [], model: "fake", head, base: "b0" };
}

describe("reviewer examples", () => {
  it("shows the spec and the feature files but not flow files or other features", () => {
    const [message] = reviewMessages({ feature, diff: { "features/shout/index.ts": "export const a = 1;\n", "features/shout/flow.ts": "flow", "features/other/index.ts": "other", "features/shout/old.ts": null } });
    expect(message?.role).toBe("user");
    expect(message?.content).toContain("- AC2: surrounding whitespace is trimmed");
    expect(message?.content).toContain("--- features/shout/index.ts\nexport const a = 1;");
    expect(message?.content).toContain("--- deleted features/shout/old.ts");
    expect(message?.content).not.toContain("flow");
    expect(message?.content).not.toContain("other");
    expect(message?.content.endsWith("Answer with one line: approve, or reject: <reason>.")).toBe(true);
  });

  it("parses answers by their first word", () => {
    expect(parseReviewAnswer("approve")).toEqual({ approve: true, reasons: [] });
    expect(parseReviewAnswer("**Approve**\nlooks fine")).toEqual({ approve: true, reasons: [] });
    expect(parseReviewAnswer("reject: whitespace is not trimmed")).toEqual({ approve: false, reasons: ["whitespace is not trimmed"] });
    expect(parseReviewAnswer("I am not sure").approve).toBe(false);
    expect(parseReviewAnswer(reviewTarget("merged")).approve).toBe(true);
    expect(parseReviewAnswer(reviewTarget("reverted")).approve).toBe(false);
    expect(parseReviewAnswer(reviewTarget("gate-failed")).approve).toBe(false);
  });

  it("formats a Gemma chat prompt that ends on the model turn", () => {
    expect(gemmaPrompt([{ role: "user", content: "hi" }])).toBe("<start_of_turn>user\nhi<end_of_turn>\n<start_of_turn>model\n");
  });

  it("labels each approved review by what happened to the change afterwards", () => {
    const log: ChefEvent[] = [
      verdict("s1", "h1"),
      { ...at, type: "gate.result", sessionId: "s1", featureId: "shout", ok: false, checks: [] },
      verdict("s1", "h2"),
      { ...at, type: "gate.result", sessionId: "s1", featureId: "shout", ok: true, checks: [] },
      { ...at, type: "main.merged", sessionId: "s1", featureId: "shout", commitId: "m1" },
      { ...at, type: "main.reverted", featureId: "shout", revertedCommit: "m1", commitId: "r1", log: "" },
      verdict("s1", "h3", false),
      verdict("s1", "h4"),
      { ...at, type: "gate.result", sessionId: "s1", featureId: "shout", ok: true, checks: [] },
      { ...at, type: "main.merged", sessionId: "s1", featureId: "shout", commitId: "m2" },
      verdict("s2", "h5"),
    ];
    expect(reviewPoints(log).map((p) => [p.head, p.outcome])).toEqual([
      ["h1", "gate-failed"],
      ["h2", "reverted"],
      ["h4", "merged"],
    ]);
  });

  it("writes one JSON object per line", () => {
    expect(toJsonl([{ a: 1 }, { b: "x" }])).toBe('{"a":1}\n{"b":"x"}\n');
    expect(toJsonl([])).toBe("");
  });
});
