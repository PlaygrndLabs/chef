import { describe, expect, it } from "vitest";
import { JevClassifier } from "../../src/jev.ts";

describe("Jev classifier", () => {
  it("reports the tokens each answer used", async () => {
    const seen: unknown[] = [];
    const client = { systemOne: async () => ({ model: "jev-1.13.0", answers: { kind: { type: "choice", choice: "build", confidence: 0.9, probabilities: { build: 0.9, ask: 0.1 } } }, usage: { input_tokens: 300, output_tokens: 2 } }) };
    const jev = new JevClassifier(client as never, "jev-1.13.0", (model, usage) => void seen.push([model, usage]));
    const answers = await jev.choose({ prompt: "add a page" }, { kind: { type: "choice", instructions: "what kind", criteria: { build: null, ask: null } } } as const);
    expect(answers.kind?.choice).toBe("build");
    expect(seen).toEqual([["jev-1.13.0", { inputTokens: 300, outputTokens: 2 }]]);
  });
});
