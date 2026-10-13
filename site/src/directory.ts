import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import { defaultOrgName, newId, type OrgSummary, type Role } from "./orgs.ts";

export type SetupState = "idle" | "running" | "done" | "failed";

export interface Identity {
  readonly provider: "cloudflare";
  readonly subject: string;
  readonly email: string | null;
}

export interface SignedIn {
  readonly userId: string;
  readonly org: OrgSummary;
  readonly orgs: readonly OrgSummary[];
}

export interface OrgSetup {
  readonly accountId: string | null;
  readonly engine: string | null;
  readonly version: string | null;
  readonly install: SetupState;
  readonly error: string | null;
}

export interface UserRow {
  readonly id: string;
  readonly email: string | null;
  readonly admin: boolean;
  readonly orgs: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface OrgRow extends OrgSetup {
  readonly id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly members: number;
  readonly createdAt: number;
}

export interface Directory {
  readonly latest: string | null;
  readonly users: readonly UserRow[];
  readonly orgs: readonly OrgRow[];
}

interface User extends Record<string, SqlStorageValue> {
  id: string;
  email: string | null;
  admin: number;
  last_org: string | null;
  first_seen: number;
  last_seen: number;
}

interface Org extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  account_id: string | null;
  engine: string | null;
  version: string | null;
  install: string;
  error: string | null;
}

interface Membership extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  role: string;
}

export class Members extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, admin INTEGER NOT NULL DEFAULT 0, last_org TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, PRIMARY KEY (provider, subject))`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, account_id TEXT, engine TEXT, version TEXT, install TEXT NOT NULL DEFAULT 'idle', error TEXT)`,
    );
    sql.exec(`CREATE TABLE IF NOT EXISTS memberships (org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (org_id, user_id))`);
    sql.exec(`CREATE INDEX IF NOT EXISTS memberships_by_user ON memberships (user_id)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS orgs_by_account ON orgs (account_id)`);
  }

  signIn(identity: Identity, admin: boolean): SignedIn {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const now = Date.now();
      const found = sql.exec<{ user_id: string }>("SELECT user_id FROM identities WHERE provider = ? AND subject = ?", identity.provider, identity.subject).toArray()[0];
      const userId = found?.user_id ?? newId("usr");
      if (!found) {
        sql.exec("INSERT INTO users (id, email, admin, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)", userId, identity.email, admin ? 1 : 0, now, now);
        sql.exec("INSERT INTO identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)", identity.provider, identity.subject, userId, identity.email);
      } else {
        sql.exec("UPDATE users SET email = ?, admin = ?, last_seen = ? WHERE id = ?", identity.email, admin ? 1 : 0, now, userId);
        sql.exec("UPDATE identities SET email = ? WHERE provider = ? AND subject = ?", identity.email, identity.provider, identity.subject);
      }
      if (this.memberships(userId).length === 0) this.insertOrg(userId, defaultOrgName(identity.email), now);
      const orgs = this.memberships(userId);
      const last = sql.exec<{ last_org: string | null }>("SELECT last_org FROM users WHERE id = ?", userId).one().last_org;
      const org = orgs.find((o) => o.id === last) ?? (orgs[0] as OrgSummary);
      sql.exec("UPDATE users SET last_org = ? WHERE id = ?", org.id, userId);
      return { userId, org, orgs };
    });
  }

  orgs(userId: string): OrgSummary[] {
    return this.memberships(userId);
  }

  createOrg(userId: string, name: string): OrgSummary {
    return this.ctx.storage.transactionSync(() => {
      const id = this.insertOrg(userId, name, Date.now());
      return { id, name, role: "owner" };
    });
  }

  use(userId: string, orgId: string): OrgSummary | null {
    const org = this.memberships(userId).find((o) => o.id === orgId) ?? null;
    if (org) this.ctx.storage.sql.exec("UPDATE users SET last_org = ? WHERE id = ?", orgId, userId);
    return org;
  }

  renameOrg(orgId: string, name: string): void {
    this.ctx.storage.sql.exec("UPDATE orgs SET name = ? WHERE id = ?", name, orgId);
  }

  recordSetup(orgId: string, setup: OrgSetup): void {
    this.ctx.storage.sql.exec(
      "UPDATE orgs SET account_id = ?, engine = ?, version = ?, install = ?, error = ? WHERE id = ?",
      setup.accountId, setup.engine, setup.version, setup.install, setup.error, orgId,
    );
  }

  accountTakenBy(accountId: string, orgId: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM orgs WHERE account_id = ? AND id != ? AND (engine IS NOT NULL OR install = 'running') LIMIT 1", accountId, orgId)
      .toArray()[0];
    return row?.name ?? null;
  }

  list(): Directory {
    const sql = this.ctx.storage.sql;
    const users = sql
      .exec<User & { orgs: number }>("SELECT users.*, (SELECT COUNT(*) FROM memberships WHERE memberships.user_id = users.id) AS orgs FROM users ORDER BY last_seen DESC")
      .toArray()
      .map((row) => ({ id: row.id, email: row.email, admin: row.admin === 1, orgs: row.orgs, firstSeen: row.first_seen, lastSeen: row.last_seen }));
    const orgs = sql
      .exec<Org & { owner: string | null; members: number }>(
        `SELECT orgs.*, (SELECT COUNT(*) FROM memberships WHERE memberships.org_id = orgs.id) AS members,
         (SELECT users.email FROM memberships JOIN users ON users.id = memberships.user_id WHERE memberships.org_id = orgs.id AND memberships.role = 'owner' ORDER BY memberships.created_at LIMIT 1) AS owner
         FROM orgs ORDER BY created_at DESC`,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        owner: row.owner,
        members: row.members,
        createdAt: row.created_at,
        accountId: row.account_id,
        engine: row.engine,
        version: row.version,
        install: row.install as SetupState,
        error: row.error,
      }));
    return { latest: this.env.ENGINE_VERSION || null, users, orgs };
  }

  private insertOrg(userId: string, name: string, now: number): string {
    const id = newId("org");
    this.ctx.storage.sql.exec("INSERT INTO orgs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)", id, name, userId, now);
    this.ctx.storage.sql.exec("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", id, userId, now);
    return id;
  }

  private memberships(userId: string): OrgSummary[] {
    return this.ctx.storage.sql
      .exec<Membership>("SELECT orgs.id AS id, orgs.name AS name, memberships.role AS role FROM memberships JOIN orgs ON orgs.id = memberships.org_id WHERE memberships.user_id = ? ORDER BY memberships.created_at, memberships.rowid", userId)
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, role: row.role as Role }));
  }
}
