import type { Clock, IdSource, KeyValueStore } from "../ports/runtime.ts";

export class ManualClock implements Clock {
  constructor(private current = Date.UTC(2026, 9, 11, 12, 0, 0)) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export class TickingClock implements Clock {
  constructor(
    private current = Date.UTC(2026, 9, 11, 12, 0, 0),
    private readonly step = 1000,
  ) {}
  now(): number {
    this.current += this.step;
    return this.current;
  }
}

export class SequentialIds implements IdSource {
  private readonly counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [key, value] of this.data) if (key.startsWith(prefix)) out.set(key, structuredClone(value) as T);
    return out;
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}
