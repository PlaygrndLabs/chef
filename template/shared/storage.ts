export interface Store {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(prefix: string): Promise<T[]>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  private readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async list<T>(prefix: string): Promise<T[]> {
    return [...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, raw]) => JSON.parse(raw) as T);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: { name: string }[] }>;
}

export class KvStore implements Store {
  private readonly kv: KvLike;

  constructor(kv: KvLike) {
    this.kv = kv;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.kv.put(key, JSON.stringify(value));
  }

  async list<T>(prefix: string): Promise<T[]> {
    const { keys } = await this.kv.list({ prefix });
    const values = await Promise.all(keys.map((k) => this.get<T>(k.name)));
    return values.filter((v): v is Awaited<T> => v !== null) as T[];
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
