import { describe, expect, it } from "vitest";
import type { PickInput, Reviewer } from "@chef/core";
import { LORA_BASE_MODEL, WorkersAiReviewer, type TextGenerator } from "../../src/workers-ai-reviewer.ts";

const feature = { id: "shout", title: "Shout", status: "building" as const, entrypoint: "POST /shout", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "uppercases" }], body: "" };

function generator(response: unknown): TextGenerator & { calls: { model: string; input: Parameters<TextGenerator["run"]>[1] }[] } {
  const calls: { model: string; input: Parameters<TextGenerator["run"]>[1] }[] = [];
  return {
    calls,
    run: async (model, input) => {
      calls.push({ model, input });
      return response;
    },
  };
}

const picker: Reviewer = {
  review: () => Promise.reject(new Error("unused")),
  pick: async (input: PickInput) => ({ sessionId: input.candidates[0]?.sessionId ?? "", reasons: ["first"], model: "picker" }),
};

describe("WorkersAiReviewer", () => {
  it("asks the tuned adapter with a raw Gemma prompt and parses its one-line answer", async () => {
    const ai = generator({ response: "reject: whitespace is not trimmed\n" });
    const reviewer = new WorkersAiReviewer(ai, "chef-reviewer", picker);
    const verdict = await reviewer.review({ feature, diff: { "features/shout/index.ts": "x" }, checksLog: "" });
    expect(verdict).toEqual({ approve: false, reasons: ["whitespace is not trimmed"], model: `${LORA_BASE_MODEL}+chef-reviewer` });
    expect(ai.calls[0]?.model).toBe(LORA_BASE_MODEL);
    expect(ai.calls[0]?.input).toMatchObject({ raw: true, lora: "chef-reviewer", temperature: 0 });
    expect(ai.calls[0]?.input.prompt.startsWith("<start_of_turn>user\n")).toBe(true);
    expect(ai.calls[0]?.input.prompt.endsWith("<start_of_turn>model\n")).toBe(true);
  });

  it("approves on an approve answer, fails loudly without text and leaves picking to the other reviewer", async () => {
    expect((await new WorkersAiReviewer(generator({ response: "approve" }), "l", picker).review({ feature, diff: {}, checksLog: "" })).approve).toBe(true);
    await expect(new WorkersAiReviewer(generator({}), "l", picker).review({ feature, diff: {}, checksLog: "" })).rejects.toThrow("returned no text");
    const pick = await new WorkersAiReviewer(generator({}), "l", picker).pick({ feature, candidates: [{ sessionId: "s1", diff: {}, crossTests: { sessionId: "s1", passed: 1, total: 1, log: "" } }] });
    expect(pick.model).toBe("picker");
  });
});
