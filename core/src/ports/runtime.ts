export interface Clock {
  now(): number;
}

export interface IdSource {
  next(prefix: string): string;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  delete(key: string): Promise<void>;
}
