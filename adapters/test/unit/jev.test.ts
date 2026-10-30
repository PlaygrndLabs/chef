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

  it("calls Jev on /v1/systemone whether its base URL ends in /v1 or not", async () => {
    const urls: string[] = [];
    const reply = { model: "jev-1.13.0", answers: { kind: { type: "choice", choice: "build", confidence: 1, probabilities: { build: 1 } } } };
    const fetch = (async (url: string | URL | Request) => (urls.push(String(url)), Response.json(reply))) as typeof globalThis.fetch;
    for (const baseURL of ["https://gateway.example", "https://gateway.example/v1/", "https://chef.example/llm/router"]) await JevClassifier.fromEnv({ apiKey: "k", baseURL, fetch }).choose({}, { kind: { type: "choice", instructions: "what kind", criteria: { build: null } } } as const);
    expect(urls).toEqual(["https://gateway.example/v1/systemone", "https://gateway.example/v1/systemone", "https://chef.example/llm/router/v1/systemone"]);
  });
});
