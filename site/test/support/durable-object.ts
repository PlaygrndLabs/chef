import { DatabaseSync } from "node:sqlite";

type Value = string | number | null;

class Cursor<T> {
  constructor(private readonly rows: T[]) {}
  toArray(): T[] {
    return this.rows;
  }
  one(): T {
    if (this.rows.length !== 1) throw new Error(`expected one row, got ${this.rows.length}`);
    return this.rows[0] as T;
  }
}

export class FakeStorage {
  private readonly db = new DatabaseSync(":memory:");
  private readonly values = new Map<string, unknown>();
  readonly sql = {
    exec: <T>(query: string, ...binds: Value[]): Cursor<T> => {
      const statement = this.db.prepare(query);
      if (/^\s*(SELECT|WITH)/i.test(query)) return new Cursor(statement.all(...binds) as T[]);
      statement.run(...binds);
      return new Cursor<T>([]);
    },
  };
  transactionSync<T>(run: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = run();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: { storage: FakeStorage },
    readonly env: Env,
  ) {}
}
