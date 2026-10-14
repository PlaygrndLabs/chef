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

export interface StoreHost {
  fetch(input: string, init: { readonly method: string; readonly body: string }): Promise<Response>;
}

export interface StoreNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): StoreHost;
}

type StoreRequest = { readonly op: "get"; readonly key: string } | { readonly op: "delete"; readonly key: string } | { readonly op: "put"; readonly key: string; readonly value: string } | { readonly op: "list"; readonly prefix: string };

export class DurableStore implements Store {
  private readonly host: StoreHost;

  constructor(namespace: StoreNamespace) {
    this.host = namespace.get(namespace.idFromName("app"));
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.send<string | null>({ op: "get", key });
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.send({ op: "put", key, value: JSON.stringify(value) });
  }

  async list<T>(prefix: string): Promise<T[]> {
    const raws = await this.send<string[]>({ op: "list", prefix });
    return raws.map((raw) => JSON.parse(raw) as T);
  }

  async delete(key: string): Promise<void> {
    await this.send({ op: "delete", key });
  }

  private async send<T>(request: StoreRequest): Promise<T> {
    const response = await this.host.fetch("https://store/", { method: "POST", body: JSON.stringify(request) });
    if (!response.ok) throw new Error(`the app's storage failed with ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  }
}

export interface ObjectStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options: { readonly prefix: string }): Promise<Map<string, unknown>>;
}

export class StoreObject {
  private readonly storage: ObjectStorage;

  constructor(state: { readonly storage: ObjectStorage }) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as StoreRequest;
    if (body.op === "get") return Response.json((await this.storage.get(body.key)) ?? null);
    if (body.op === "put") {
      await this.storage.put(body.key, body.value);
      return Response.json(null);
    }
    if (body.op === "delete") {
      await this.storage.delete(body.key);
      return Response.json(null);
    }
    return Response.json([...(await this.storage.list({ prefix: body.prefix })).values()]);
  }
}
