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
    const llm = llmFromEnv({ LLM_BASE_URL: "https://llm.example/", LLM_API_KEY: "local-key", ANTHROPIC_API_KEY: "ignored" }, fetchImpl);
    expect(llm.via).toBe("custom");
    const result = await structured(llm, { model: "claude-opus-5-5", system: "s", prompt: "p", schema: z.object({ approve: z.boolean(), reasons: z.array(z.string()) }) });
    expect(result).toEqual({ approve: true, reasons: [] });
    const [request] = seen;
    expect(request?.url).toBe("https://llm.example/v1/messages");
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
    const { seen, fetchImpl } = custom({ approve: false, reasons: ["AC2 has no test"], retest: true, criteria: [{ id: "AC1", verdict: "met", evidence: "add() in features/todo-add/index.ts" }] });
    const reviewer = new LlmReviewer(llmFromProvider({ kind: "custom", baseUrl: "https://llm.example", apiKey: "k" }, fetchImpl), "reviewer-model", "Review the diff.");
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "adds" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "", scope: ["features/todo-add/**", "features/todo/**"] });
    expect(verdict).toMatchObject({ approve: false, reasons: ["AC2 has no test"], retest: true });
    expect(JSON.stringify(seen[0]?.body["messages"])).toContain("- features/todo/**");
  });

  it("asks the reviewer's model for the role's effort, and for high when the role has none", async () => {
    const { seen, fetchImpl } = custom({ approve: true, reasons: [], retest: false, criteria: [] });
    const llm = llmFromProvider({ kind: "custom", baseUrl: "https://llm.example", apiKey: "k" }, fetchImpl);
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "adds" }], body: "b" };
    await new LlmReviewer(llm, "reviewer-model", "Review the diff.", undefined, "max").review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "" });
    await new LlmReviewer(llm, "reviewer-model", "Review the diff.").review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "" });
    expect(seen.map((call) => (call.body["output_config"] as { effort?: string } | undefined)?.effort)).toEqual(["max", "high"]);
  });

  it("asks for changes when the reviewer marks a criterion missing, and keeps every criterion's evidence", async () => {
    const criteria = [
      { id: "AC1", verdict: "met", evidence: "add() in features/todo-add/index.ts; test AC1: adds" },
      { id: "AC2", verdict: "missing", evidence: "no route rejects an empty title" },
      { id: "AC3", verdict: "unsure", evidence: "the list page is not in the diff" },
    ];
    const { fetchImpl } = custom({ approve: true, reasons: [], retest: false, criteria });
    const reviewer = new LlmReviewer(llmFromProvider({ kind: "custom", baseUrl: "https://llm.example", apiKey: "k" }, fetchImpl), "reviewer-model", "Review the diff.");
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "adds" }, { id: "AC2", text: "refuses an empty title" }, { id: "AC3", text: "lists" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "features/todo-add/index.ts": "export {}" }, checksLog: "" });
    expect(verdict).toMatchObject({ approve: false, reasons: ["AC2 is not done: no route rejects an empty title"], criteria });
  });

  it("shows the reviewer the slice's unchanged files so code already on main counts", async () => {
    const { seen, fetchImpl } = custom({ approve: true, reasons: [], retest: false, criteria: [] });
    const reviewer = new LlmReviewer(llmFromProvider({ kind: "custom", baseUrl: "https://llm.example", apiKey: "k" }, fetchImpl), "reviewer-model", "Review the diff.");
    const feature = { id: "todo-add", title: "Add", status: "building" as const, entrypoint: "POST /todos", revision: 2, shared: [], env: [], acceptance: [{ id: "AC1", text: "adds" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "spec/features/todo-add.md": "revision 2" }, existing: { "features/todo-add/routes.ts": "export const add = 1", "features/todo-add/todo-add.test.ts": 'test("AC1: adds")' }, checksLog: "" });
    expect(verdict).toMatchObject({ approve: true });
    const prompt = JSON.stringify(seen[0]?.body["messages"]);
    expect(prompt).toContain("Already in this feature's slice and unchanged by the diff");
    expect(prompt).toContain("--- features/todo-add/routes.ts");
  });

  it("reviews a change that rewrites a big lockfile without its contents", async () => {
    const { seen, fetchImpl } = custom({ approve: true, reasons: [], retest: false, criteria: [] });
    const reviewer = new LlmReviewer(llmFromProvider({ kind: "custom", baseUrl: "https://llm.example", apiKey: "k" }, fetchImpl), "reviewer-model", "Review the diff.", 1000);
    const feature = { id: "todo-due", title: "Due", status: "building" as const, entrypoint: "GET /", revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: "shows" }], body: "b" };
    const verdict = await reviewer.review({ feature, diff: { "src/app.js": "due()", "package-lock.json": "x".repeat(5000) }, checksLog: "" });
    expect(verdict).toMatchObject({ approve: true });
    const prompt = JSON.stringify(seen[0]?.body["messages"]);
    expect(prompt).toContain("package-lock.json (lockfile the package manager wrote, 5000 characters, not shown)");
    expect(prompt).not.toContain("xxxxxxxxxx");
  });

  it("asks for a configured endpoint", () => {
    expect(() => llmFromEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => llmFromEnv({ LLM_BASE_URL: "https://llm.example" })).toThrow(/LLM_API_KEY/);
    expect(llmFromEnv({ ANTHROPIC_API_KEY: "k" }).serverFallbacks).toBe(true);
    expect(providerBaseUrl({ kind: "anthropic", apiKey: "k" })).toBe("https://api.anthropic.com");
    expect(providerBaseUrl({ kind: "custom", baseUrl: "https://llm.example/", apiKey: "k" })).toBe("https://llm.example");
  });
});
