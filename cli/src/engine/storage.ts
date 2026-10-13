import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChefEvent, EventBus, KeyValueStore, MemoryDoc, MemoryHit, MemoryIndex, MemoryKind } from "@chef/core";
import { LexicalIndex } from "@chef/core/fakes";

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

export function writeAtomic(file: string, text: string, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode });
  renameSync(temp, file);
}

export class FileStore implements KeyValueStore {
  private readonly values = new Map<string, string>();
  private lines = 0;

  constructor(private readonly file: string) {
    for (const line of readLines(file)) {
      try {
        const { k, v, d } = JSON.parse(line) as { k: string; v?: string; d?: 1 };
        if (d) this.values.delete(k);
        else if (v !== undefined) this.values.set(k, v);
        this.lines++;
      } catch {
        continue;
      }
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.values.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    const raw = JSON.stringify(value ?? null);
    if (this.values.get(key) === raw) return;
    this.values.set(key, raw);
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify({ k: key, v: raw })}\n`, { mode: 0o600 });
    if (++this.lines > this.values.size * 4 + 1000) this.compact();
  }

  async delete(key: string): Promise<void> {
    if (!this.values.delete(key)) return;
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify({ k: key, d: 1 })}\n`, { mode: 0o600 });
    this.lines++;
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [key, raw] of [...this.values].sort(([a], [b]) => a.localeCompare(b))) if (key.startsWith(prefix)) out.set(key, JSON.parse(raw) as T);
    return out;
  }

  private compact(): void {
    writeAtomic(this.file, [...this.values].map(([k, v]) => `${JSON.stringify({ k, v })}\n`).join(""));
    this.lines = this.values.size;
  }
}

export interface LogEntry {
  readonly seq: number;
  readonly event: ChefEvent;
}

export class FileEventBus implements EventBus {
  private readonly listeners = new Set<(event: ChefEvent) => void>();
  private readonly watchers = new Set<(entry: LogEntry) => void>();
  private entries: LogEntry[] = [];
  private lines = 0;

  constructor(
    private readonly file: string,
    private readonly keep = 5000,
  ) {
    for (const line of readLines(file)) {
      try {
        this.entries.push(JSON.parse(line) as LogEntry);
        this.lines++;
      } catch {
        continue;
      }
    }
    this.entries = this.entries.slice(-keep);
  }

  async publish(event: ChefEvent): Promise<void> {
    const entry = { seq: (this.entries.at(-1)?.seq ?? 0) + 1, event };
    this.entries.push(entry);
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    if (++this.lines > this.keep * 2) {
      this.entries = this.entries.slice(-this.keep);
      writeAtomic(this.file, this.entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
      this.lines = this.entries.length;
    }
    for (const watcher of [...this.watchers]) watcher(entry);
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: (event: ChefEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watch(watcher: (entry: LogEntry) => void): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  async cursor(): Promise<number> {
    return this.entries.at(-1)?.seq ?? 0;
  }

  async since(after: number, limit = 500): Promise<LogEntry[]> {
    return this.entries.filter((e) => e.seq > after).slice(0, limit);
  }
}

export class FileMemoryIndex implements MemoryIndex {
  private readonly index = new LexicalIndex();
  private readonly docs = new Map<string, MemoryDoc>();

  constructor(private readonly file: string) {
    if (!existsSync(file)) return;
    try {
      for (const doc of JSON.parse(readFileSync(file, "utf8")) as MemoryDoc[]) this.docs.set(doc.path, doc);
    } catch {
      this.docs.clear();
    }
    void this.index.upsert([...this.docs.values()]);
  }

  async upsert(docs: readonly MemoryDoc[]): Promise<void> {
    for (const doc of docs) this.docs.set(doc.path, doc);
    await this.index.upsert(docs);
    this.save();
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.docs.delete(path);
    await this.index.remove(paths);
    this.save();
  }

  query(text: string, limit: number, kinds?: readonly MemoryKind[]): Promise<MemoryHit[]> {
    return this.index.query(text, limit, kinds);
  }

  private save(): void {
    writeAtomic(this.file, JSON.stringify([...this.docs.values()]));
  }
}
