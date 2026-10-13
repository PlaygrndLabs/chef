declare module "node:sqlite" {
  interface StatementSync {
    all(...binds: (string | number | null)[]): unknown[];
    run(...binds: (string | number | null)[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(query: string): StatementSync;
    exec(query: string): void;
  }
}
