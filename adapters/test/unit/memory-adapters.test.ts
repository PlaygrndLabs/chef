import { describe, expect, it } from "vitest";
import { llmFromProvider } from "../../src/anthropic.ts";
import { LlmPlanner } from "../../src/llm-planner.ts";
import { EMBEDDING_MODEL, VectorizeIndex, type EmbedderLike, type VectorizeLike } from "../../src/vectorize.ts";

class FakeVectorize implements VectorizeLike {
  readonly vectors = new Map<string, { values: number[]; metadata: Record<string, string> }>();
  readonly filters: Record<string, unknown>[] = [];

  async upsert(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[]): Promise<void> {
    for (const v of vectors) this.vectors.set(v.id, { values: v.values, metadata: v.metadata ?? {} });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.vectors.delete(id);
  }

  async query(vector: number[], options: { topK: number; filter?: Record<string, unknown> }) {
    this.filters.push(options.filter ?? {});
    const kinds = (options.filter?.["kind"] as { $in?: string[] } | undefined)?.$in;
    const matches = [...this.vectors]
      .filter(([, v]) => v.metadata["project"] === options.filter?.["project"] && (!kinds || kinds.includes(v.metadata["kind"] as string)))
      .map(([id, v]) => ({ id, score: v.values.reduce((sum, x, i) => sum + x * (vector[i] ?? 0), 0), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);
    return { matches };
  }
}

const WORDS = ["emoji", "reverse", "slug", "dash"];

class WordEmbedder implements EmbedderLike {
  readonly models: string[] = [];

  async run(model: string, input: { text: string[] }) {
    this.models.push(model);
    return { data: input.text.map((t) => WORDS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0))) };
  }
}

describe("memory adapters", () => {
  it("stores memory docs in Vectorize per project and filters queries by project and kind", async () => {
    const index = new FakeVectorize();
    const ai = new WordEmbedder();
    const demo = new VectorizeIndex(index, ai, "demo");
    const other = new VectorizeIndex(index, ai, "other");
    await demo.upsert([
      { path: "memory/lessons/reverse-1.md", kind: "lesson", feature: "reverse", text: "emoji broke reverse" },
      { path: "spec/features/slug.md", kind: "spec", feature: "slug", text: "slug joins with a dash" },
    ]);
    await other.upsert([{ path: "memory/lessons/reverse-1.md", kind: "lesson", feature: "reverse", text: "emoji reverse elsewhere" }]);

    const hits = await demo.query("reverse emoji", 5, ["lesson", "feature"]);
    expect(hits.map((h) => [h.doc.path, h.doc.kind, h.doc.feature, h.doc.text])).toEqual([["memory/lessons/reverse-1.md", "lesson", "reverse", "emoji broke reverse"]]);
    expect(index.filters.at(-1)).toEqual({ project: "demo", kind: { $in: ["lesson", "feature"] } });
    expect(ai.models.every((m) => m === EMBEDDING_MODEL)).toBe(true);

    await demo.remove(["memory/lessons/reverse-1.md"]);
    expect(await demo.query("reverse emoji", 5, ["lesson"])).toEqual([]);
    expect(await other.query("reverse emoji", 5, ["lesson"])).toHaveLength(1);
  });

  it("answers a question from the recalled memory through the planner model", async () => {
    let prompt = "";
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      prompt = body.messages[0]?.content ?? "";
      const message = { id: "m", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: JSON.stringify({ answer: "Reverse splits by code point (memory/lessons/reverse-1.md)." }) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const planner = new LlmPlanner(llmFromProvider({ kind: "custom", baseUrl: "http://127.0.0.1:8317", apiKey: "k" }, fetchImpl), "planner-model");
    const answer = await planner.answer({ question: "Why does reverse use code points?", context: [{ score: 1, doc: { path: "memory/lessons/reverse-1.md", kind: "lesson", feature: "reverse", text: "emoji broke reverse" } }] });
    expect(answer).toContain("memory/lessons/reverse-1.md");
    expect(prompt).toContain("### memory/lessons/reverse-1.md\nemoji broke reverse");
    expect(prompt).toContain("Why does reverse use code points?");
  });
});
