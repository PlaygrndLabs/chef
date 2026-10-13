import type { KeyValueStore } from "@chef/core";

export class DurableStore implements KeyValueStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.storage.put(key, value);
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    return this.storage.list<T>({ prefix });
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
