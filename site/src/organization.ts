import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import type { Engine } from "./member.ts";
import type { Role } from "./orgs.ts";

export interface OrgAccess {
  readonly role: Role;
  readonly engine: Engine | null;
}

export interface OrgView {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly engine: string | null;
  readonly members: number;
}

export interface OrgMember {
  readonly userId: string;
  readonly email: string | null;
  readonly role: Role;
  readonly joinedAt: number;
}

interface Meta {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

interface MemberRow extends Record<string, SqlStorageValue> {
  user_id: string;
  email: string | null;
  role: string;
  joined_at: number;
}

const META = "meta";
const ENGINE = "engine";

export class Organization extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, email TEXT, role TEXT NOT NULL, joined_at INTEGER NOT NULL)`);
  }

  async setup(org: { readonly id: string; readonly name: string }, member: { readonly userId: string; readonly email: string | null; readonly role: Role }): Promise<void> {
    if (!(await this.ctx.storage.get<Meta>(META))) await this.ctx.storage.put(META, { id: org.id, name: org.name, createdAt: Date.now() } satisfies Meta);
    this.ctx.storage.sql.exec(
      `INSERT INTO members (user_id, email, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, role = excluded.role`,
      member.userId, member.email, member.role, Date.now(),
    );
  }

  async access(userId: string): Promise<OrgAccess | null> {
    const role = this.role(userId);
    return role ? { role, engine: (await this.ctx.storage.get<Engine>(ENGINE)) ?? null } : null;
  }

  async view(userId: string): Promise<OrgView | null> {
    const meta = await this.ctx.storage.get<Meta>(META);
    const role = this.role(userId);
    if (!meta || !role) return null;
    const engine = await this.ctx.storage.get<Engine>(ENGINE);
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
    return { id: meta.id, name: meta.name, role, engine: engine?.url ?? null, members: count };
  }

  async members(): Promise<OrgMember[]> {
    return this.ctx.storage.sql
      .exec<MemberRow>("SELECT * FROM members ORDER BY joined_at, rowid")
      .toArray()
      .map((row) => ({ userId: row.user_id, email: row.email, role: row.role as Role, joinedAt: row.joined_at }));
  }

  async rename(name: string): Promise<void> {
    const meta = await this.ctx.storage.get<Meta>(META);
    if (meta) await this.ctx.storage.put(META, { ...meta, name });
  }

  async engine(): Promise<Engine | null> {
    return (await this.ctx.storage.get<Engine>(ENGINE)) ?? null;
  }

  async setEngine(engine: Engine): Promise<void> {
    await this.ctx.storage.put(ENGINE, engine);
  }

  private role(userId: string): Role | null {
    const row = this.ctx.storage.sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0];
    return row ? (row.role as Role) : null;
  }
}
