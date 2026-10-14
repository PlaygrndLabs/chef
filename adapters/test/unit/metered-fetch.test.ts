import { describe, expect, it } from "vitest";
import { meteredFetch } from "../../src/anthropic.ts";

describe("metered fetch", () => {
  it("reports each model reply's tokens, counting cache reads apart, and leaves the reply untouched", async () => {
    const seen: unknown[] = [];
    const body = { model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } };
    const base = (async () => Response.json(body)) as unknown as typeof fetch;
    const response = await meteredFetch((model, usage) => void seen.push([model, usage]), base)("https://llm.example/v1/messages");
    expect(await response.json()).toEqual(body);
    expect(seen).toEqual([["claude-opus-5-5", { inputTokens: 1050, outputTokens: 20, cachedInputTokens: 900 }]]);
  });

  it("ignores failures, streams and replies without usage", async () => {
    const seen: unknown[] = [];
    const listen = (model: string) => void seen.push(model);
    await meteredFetch(listen, (async () => Response.json({ error: "no" }, { status: 500 })) as unknown as typeof fetch)("x");
    await meteredFetch(listen, (async () => new Response("data: {}", { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch)("x");
    await meteredFetch(listen, (async () => Response.json({ model: "m" })) as unknown as typeof fetch)("x");
    expect(seen).toEqual([]);
  });
});
