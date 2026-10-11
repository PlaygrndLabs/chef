import { describe, expect, it } from "vitest";
import { z } from "zod";
import { llmFromEnv, structured } from "../../src/anthropic.ts";
import { LlmReviewer } from "../../src/llm-reviewer.ts";

interface Seen {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

function cpa(reply: unknown) {
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
  it("sends structured requests to CPA without beta headers or fallbacks", async () => {
    const { seen, fetchImpl } = cpa({ approve: true, reasons: [] });
    const llm = llmFromEnv({ CPA_BASE_URL: "http://127.0.0.1:8317/", CPA_API_KEY: "local-key", ANTHROPIC_API_KEY: "ignored" }, fetchImpl);
    expect(llm.via).toBe("cpa");
    const result = await structured(llm, { model: "claude-opus-5-5", system: "s", prompt: "p", schema: z.object({ approve: z.boolean(), reasons: z.array(z.string()) }) });
    expect(result).toEqual({ approve: true, reasons: [] });
    const [request] = seen;
    expect(request?.url).toBe("http://127.0.0.1:8317/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("local-key");
    expect(request?.headers.get("anthropic-beta")).toBeNull();
    expect(request?.body["fallbacks"]).toBeUndefined();
    expect((request?.body["output_config"] as { format: { type: string } }).format.type).toBe("json_schema");
  });

  it("drives the reviewer through CPA", async () => {
    const { fetchImpl } = cpa({ approve: false, reasons: ["AC2 has no test"] });
    const reviewer = new LlmReviewer(llmFromEnv({ CPA_BASE_URL: "http://127.0.0.1:8317", CPA_API_KEY: "k" }, fetchImpl));
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 1, shared: [], acceptance: [{ id: "AC1", text: "adds" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "" });
    expect(verdict).toMatchObject({ approve: false, reasons: ["AC2 has no test"] });
  });

  it("asks for a configured endpoint", () => {
    expect(() => llmFromEnv({})).toThrow(/CPA_BASE_URL/);
    expect(() => llmFromEnv({ CPA_BASE_URL: "http://127.0.0.1:8317" })).toThrow(/CPA_API_KEY/);
    expect(llmFromEnv({ ANTHROPIC_API_KEY: "k" }).serverFallbacks).toBe(true);
  });
});
