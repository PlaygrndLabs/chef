import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import type { Engine } from "./member.ts";
import { highest, type OrgPlan, type ProjectLevel, type Role, type Visibility } from "./orgs.ts";

export interface OrgAccess {
  readonly role: Role;
  readonly engine: Engine | null;
  readonly level: ProjectLevel | null;
}

export interface ProjectPerson {
  readonly userId: string;
  readonly email: string | null;
  readonly level: ProjectLevel;
}

export interface ProjectSharing {
  readonly name: string;
  readonly visibility: Visibility;
  readonly orgLevel: ProjectLevel;
  readonly createdBy: string | null;
  readonly people: readonly ProjectPerson[];
}

export interface OrgView {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly personal: boolean;
  readonly plan: OrgPlan;
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
  readonly personal: boolean;
  readonly createdAt: number;
}

interface ProjectRow extends Record<string, SqlStorageValue> {
  name: string;
  created_by: string;
  visibility: string;
  org_level: string;
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
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, created_by TEXT NOT NULL, visibility TEXT NOT NULL, org_level TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS project_people (project TEXT NOT NULL, user_id TEXT NOT NULL, level TEXT NOT NULL, PRIMARY KEY (project, user_id))`);
  }

  async setup(org: { readonly id: string; readonly name: string; readonly personal: boolean }, member: { readonly userId: string; readonly email: string | null; readonly role: Role }): Promise<void> {
    if (!(await this.ctx.storage.get<Meta>(META))) await this.ctx.storage.put(META, { id: org.id, name: org.name, personal: org.personal, createdAt: Date.now() } satisfies Meta);
    this.ctx.storage.sql.exec(
      `INSERT INTO members (user_id, email, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, role = excluded.role`,
      member.userId, member.email, member.role, Date.now(),
    );
  }

  async access(userId: string, project: string | null = null): Promise<OrgAccess | null> {
    const role = this.role(userId);
    return role ? { role, engine: (await this.ctx.storage.get<Engine>(ENGINE)) ?? null, level: project ? this.level(userId, role, project) : null } : null;
  }

  levels(userId: string, names: readonly string[]): Record<string, ProjectLevel> {
    const role = this.role(userId);
    const out: Record<string, ProjectLevel> = {};
    if (!role) return out;
    for (const name of names) {
      const level = this.level(userId, role, name);
      if (level) out[name] = level;
    }
    return out;
  }

  claimProject(userId: string, name: string): boolean {
    const role = this.role(userId);
    if (!role) return false;
    const row = this.project(name);
    if (row && row.created_by !== userId && this.level(userId, role, name) !== "manage") return false;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM project_people WHERE project = ?", name);
      this.ctx.storage.sql.exec(
        "INSERT INTO projects (name, created_by, visibility, org_level, created_at) VALUES (?, ?, 'private', 'edit', ?) ON CONFLICT(name) DO UPDATE SET created_by = excluded.created_by, visibility = 'private', org_level = 'edit'",
        name, userId, Date.now(),
      );
      this.ctx.storage.sql.exec("INSERT INTO project_people (project, user_id, level) VALUES (?, ?, 'manage')", name, userId);
    });
    return true;
  }

  sharing(name: string): ProjectSharing {
    const row = this.project(name);
    const people = this.ctx.storage.sql
      .exec<{ user_id: string; email: string | null; level: string }>(
        "SELECT project_people.user_id AS user_id, members.email AS email, project_people.level AS level FROM project_people JOIN members ON members.user_id = project_people.user_id WHERE project = ? ORDER BY members.joined_at, members.rowid",
        name,
      )
      .toArray()
      .map((p) => ({ userId: p.user_id, email: p.email, level: p.level as ProjectLevel }));
    return { name, visibility: (row?.visibility as Visibility | undefined) ?? "private", orgLevel: (row?.org_level as ProjectLevel | undefined) ?? "edit", createdBy: row?.created_by ?? null, people };
  }

  share(userId: string, name: string, visibility: Visibility, orgLevel: ProjectLevel): ProjectSharing {
    this.ctx.storage.sql.exec(
      "INSERT INTO projects (name, created_by, visibility, org_level, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET visibility = excluded.visibility, org_level = excluded.org_level",
      name, userId, visibility, orgLevel, Date.now(),
    );
    return this.sharing(name);
  }

  setLevel(userId: string, name: string, person: string, level: ProjectLevel | null): ProjectSharing | null {
    if (!this.role(person)) return null;
    if (!this.project(name)) this.share(userId, name, "private", "edit");
    if (level) this.ctx.storage.sql.exec("INSERT INTO project_people (project, user_id, level) VALUES (?, ?, ?) ON CONFLICT(project, user_id) DO UPDATE SET level = excluded.level", name, person, level);
    else this.ctx.storage.sql.exec("DELETE FROM project_people WHERE project = ? AND user_id = ?", name, person);
    return this.sharing(name);
  }

  setRole(userId: string, role: Role): boolean {
    if (!this.role(userId) || (role !== "owner" && this.isLastOwner(userId))) return false;
    this.ctx.storage.sql.exec("UPDATE members SET role = ? WHERE user_id = ?", role, userId);
    return true;
  }

  removeMember(userId: string): boolean {
    if (!this.role(userId) || this.isLastOwner(userId)) return false;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id = ?", userId);
      this.ctx.storage.sql.exec("DELETE FROM project_people WHERE user_id = ?", userId);
    });
    return true;
  }

  async view(userId: string): Promise<OrgView | null> {
    const meta = await this.ctx.storage.get<Meta>(META);
    const role = this.role(userId);
    if (!meta || !role) return null;
    const engine = await this.ctx.storage.get<Engine>(ENGINE);
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
    return { id: meta.id, name: meta.name, role, personal: meta.personal, plan: "free", engine: engine?.url ?? null, members: count };
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

  private isLastOwner(userId: string): boolean {
    return this.role(userId) === "owner" && this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE role = 'owner'").one().n <= 1;
  }

  private project(name: string): ProjectRow | null {
    return this.ctx.storage.sql.exec<ProjectRow>("SELECT * FROM projects WHERE name = ?", name).toArray()[0] ?? null;
  }

  private level(userId: string, role: Role, name: string): ProjectLevel | null {
    if (role === "owner" || role === "admin") return "manage";
    const row = this.project(name);
    if (!row) return null;
    const own = this.ctx.storage.sql.exec<{ level: string }>("SELECT level FROM project_people WHERE project = ? AND user_id = ?", name, userId).toArray()[0];
    return highest(own?.level as ProjectLevel | undefined, row.visibility === "org" ? (row.org_level as ProjectLevel) : null);
  }

  private role(userId: string): Role | null {
    const row = this.ctx.storage.sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0];
    return row ? (row.role as Role) : null;
  }
}
