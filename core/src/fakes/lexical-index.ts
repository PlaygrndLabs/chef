import type { MemoryDoc, MemoryHit, MemoryIndex, MemoryKind } from "../ports/memory-index.ts";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "with", "that", "this", "be", "as", "by", "at", "are", "was", "from"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export class LexicalIndex implements MemoryIndex {
  private readonly docs = new Map<string, { doc: MemoryDoc; terms: Map<string, number> }>();

  async upsert(docs: readonly MemoryDoc[]): Promise<void> {
    for (const doc of docs) {
      const terms = new Map<string, number>();
      for (const t of tokens(`${doc.feature ?? ""} ${doc.text}`)) terms.set(t, (terms.get(t) ?? 0) + 1);
      this.docs.set(doc.path, { doc, terms });
    }
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.docs.delete(path);
  }

  async query(text: string, limit: number, kinds?: readonly MemoryKind[]): Promise<MemoryHit[]> {
    const query = new Set(tokens(text));
    const all = [...this.docs.values()].filter((d) => !kinds || kinds.includes(d.doc.kind));
    const df = new Map<string, number>();
    for (const d of all) for (const t of d.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const hits: MemoryHit[] = [];
    for (const d of all) {
      let score = 0;
      let norm = 0;
      for (const [t, tf] of d.terms) {
        const weight = (1 + Math.log(tf)) * Math.log(1 + all.length / (df.get(t) ?? 1));
        norm += weight * weight;
        if (query.has(t)) score += weight;
      }
      if (score > 0) hits.push({ doc: d.doc, score: score / Math.sqrt(norm || 1) });
    }
    return hits.sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path)).slice(0, limit);
  }

  get size(): number {
    return this.docs.size;
  }
}
