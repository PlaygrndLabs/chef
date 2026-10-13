import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

export interface MemberEntry {
  readonly id: string;
  readonly email: string | null;
  readonly admin: boolean;
  readonly accountId: string | null;
  readonly engine: string | null;
  readonly version: string | null;
  readonly install: "idle" | "running" | "done" | "failed";
  readonly error: string | null;
}

export interface MemberRow extends MemberEntry {
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface Directory {
  readonly latest: string | null;
  readonly members: readonly MemberRow[];
}

interface Row extends Record<string, SqlStorageValue> {
  id: string;
  email: string | null;
  admin: number;
  account_id: string | null;
  engine: string | null;
  version: string | null;
  install: string;
  error: string | null;
  first_seen: number;
  last_seen: number;
}

export class Members extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, email TEXT, admin INTEGER NOT NULL DEFAULT 0, account_id TEXT, engine TEXT, version TEXT, install TEXT NOT NULL DEFAULT 'idle', error TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
    );
  }

  record(entry: MemberEntry, signedIn: boolean): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO members (id, email, admin, account_id, engine, version, install, error, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, admin = excluded.admin, account_id = excluded.account_id, engine = excluded.engine, version = excluded.version, install = excluded.install, error = excluded.error${signedIn ? ", last_seen = excluded.last_seen" : ""}`,
      entry.id, entry.email, entry.admin ? 1 : 0, entry.accountId, entry.engine, entry.version, entry.install, entry.error, now, now,
    );
  }

  list(): Directory {
    const rows = this.ctx.storage.sql.exec<Row>("SELECT * FROM members ORDER BY last_seen DESC").toArray();
    return {
      latest: this.env.ENGINE_VERSION || null,
      members: rows.map((row) => ({
        id: row.id,
        email: row.email,
        admin: row.admin === 1,
        accountId: row.account_id,
        engine: row.engine,
        version: row.version,
        install: row.install as MemberEntry["install"],
        error: row.error,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      })),
    };
  }
}
