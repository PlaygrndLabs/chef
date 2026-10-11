export type MemoryKind = "lesson" | "feature" | "spec" | "note";

export interface MemoryDoc {
  readonly path: string;
  readonly kind: MemoryKind;
  readonly feature: string | null;
  readonly text: string;
}

export interface MemoryHit {
  readonly doc: MemoryDoc;
  readonly score: number;
}

export interface MemoryIndex {
  upsert(docs: readonly MemoryDoc[]): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;
  query(text: string, limit: number, kinds?: readonly MemoryKind[]): Promise<MemoryHit[]>;
}
