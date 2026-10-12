import { hashHex, type MemoryDoc, type MemoryHit, type MemoryIndex, type MemoryKind } from "@chef/core";

export interface VectorizeLike {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(vector: number[], options: { topK: number; returnMetadata: "all"; filter?: Record<string, unknown> }): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
}

export interface EmbedderLike {
  run(model: string, input: { text: string[] }): Promise<unknown>;
}

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

const KINDS: readonly MemoryKind[] = ["lesson", "feature", "spec", "note"];

export class VectorizeIndex implements MemoryIndex {
  constructor(
    private readonly index: VectorizeLike,
    private readonly ai: EmbedderLike,
    private readonly project: string,
    private readonly model: string = EMBEDDING_MODEL,
  ) {}

  private id(path: string): string {
    return hashHex(`${this.project}:${path}`).slice(0, 32);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const result = (await this.ai.run(this.model, { text: texts.slice(i, i + 50).map((t) => t.slice(0, 2000)) })) as { data?: number[][] };
      if (!result.data) throw new Error(`embedding model ${this.model} returned no data`);
      out.push(...result.data);
    }
    return out;
  }

  async upsert(docs: readonly MemoryDoc[]): Promise<void> {
    if (docs.length === 0) return;
    const vectors = await this.embed(docs.map((d) => `${d.feature ?? ""}\n${d.text}`));
    await this.index.upsert(
      docs.map((doc, i) => ({
        id: this.id(doc.path),
        values: vectors[i] as number[],
        metadata: { project: this.project, path: doc.path, kind: doc.kind, feature: doc.feature ?? "", text: doc.text.slice(0, 4000) },
      })),
    );
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length) await this.index.deleteByIds(paths.map((p) => this.id(p)));
  }

  async query(text: string, limit: number, kinds?: readonly MemoryKind[]): Promise<MemoryHit[]> {
    const [vector] = await this.embed([text]);
    const filter: Record<string, unknown> = { project: this.project };
    if (kinds) filter["kind"] = { $in: [...kinds] };
    const { matches } = await this.index.query(vector as number[], { topK: limit, returnMetadata: "all", filter });
    return matches.map((m) => {
      const meta = m.metadata ?? {};
      const kind = KINDS.includes(meta["kind"] as MemoryKind) ? (meta["kind"] as MemoryKind) : "note";
      const feature = typeof meta["feature"] === "string" && meta["feature"] ? (meta["feature"] as string) : null;
      return { score: m.score, doc: { path: String(meta["path"] ?? m.id), kind, feature, text: String(meta["text"] ?? "") } };
    });
  }
}
