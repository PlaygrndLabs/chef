import { describe, expect, it } from "vitest";
import { z } from "zod";
import { llmFromEnv, llmFromProvider, providerBaseUrl, structured } from "../../src/anthropic.ts";
import { LlmReviewer } from "../../src/llm-reviewer.ts";

interface Seen {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

function custom(reply: unknown) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const message = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(reply) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("llm endpoint", () => {
  it("sends structured requests to a custom provider without beta headers or fallbacks", async () => {
    const { seen, fetchImpl } = custom({ approve: true, reasons: [] });
    const llm = llmFromEnv({ LLM_BASE_URL: "http://127.0.0.1:8317/", LLM_API_KEY: "local-key", ANTHROPIC_API_KEY: "ignored" }, fetchImpl);
    expect(llm.via).toBe("custom");
    const result = await structured(llm, { model: "claude-opus-5-5", system: "s", prompt: "p", schema: z.object({ approve: z.boolean(), reasons: z.array(z.string()) }) });
    expect(result).toEqual({ approve: true, reasons: [] });
    const [request] = seen;
    expect(request?.url).toBe("http://127.0.0.1:8317/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("local-key");
    expect(request?.headers.get("anthropic-beta")).toBeNull();
    expect(request?.body["fallbacks"]).toBeUndefined();
    expect((request?.body["output_config"] as { format: { type: string } }).format.type).toBe("json_schema");
  });

  it("waits out a custom provider that is still starting", async () => {
    const { seen, fetchImpl } = custom({ approve: true, reasons: [] });
    let calls = 0;
    const waking = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls <= 3) return new Response(JSON.stringify({ error: { type: "api_error", message: "The gateway is starting" } }), { status: 503, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
      return fetchImpl(url, init);
    }) as typeof fetch;
    const llm = llmFromProvider({ kind: "custom", baseUrl: "https://gateway.example", apiKey: "k" }, waking);
    expect(await structured(llm, { model: "m", system: "s", prompt: "p", schema: z.object({ approve: z.boolean(), reasons: z.array(z.string()) }) })).toEqual({ approve: true, reasons: [] });
    expect(calls).toBe(4);
    expect(seen).toHaveLength(1);
  });

  it("drives the reviewer through a custom provider", async () => {
    const { fetchImpl } = custom({ approve: false, reasons: ["AC2 has no test"], retest: true });
    const reviewer = new LlmReviewer(llmFromProvider({ kind: "custom", baseUrl: "http://127.0.0.1:8317", apiKey: "k" }, fetchImpl), "reviewer-model", "Review the diff.");
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "adds" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "" });
    expect(verdict).toMatchObject({ approve: false, reasons: ["AC2 has no test"], retest: true });
  });

  it("asks for a configured endpoint", () => {
    expect(() => llmFromEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => llmFromEnv({ LLM_BASE_URL: "http://127.0.0.1:8317" })).toThrow(/LLM_API_KEY/);
    expect(llmFromEnv({ ANTHROPIC_API_KEY: "k" }).serverFallbacks).toBe(true);
    expect(providerBaseUrl({ kind: "anthropic", apiKey: "k" })).toBe("https://api.anthropic.com");
    expect(providerBaseUrl({ kind: "custom", baseUrl: "https://llm.example/", apiKey: "k" })).toBe("https://llm.example");
  });
});
