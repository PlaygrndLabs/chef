import { WorkerEntrypoint } from "cloudflare:workers";
import type { Directory, Invite, OrgRow, UserRow } from "./directory.ts";
import { engineProjects, engineSpending, setEngineBudget, type Spending } from "./engine.ts";
import { directory, member, organization, type Env } from "./env.ts";
import type { InstallStatus, RemovalStatus } from "./member.ts";
import type { OrgMember } from "./organization.ts";
import { isId, isRole, readEmail, readOrgName, type OrgSummary, type Role } from "./orgs.ts";

export interface Admin {
  readonly userId: string;
  readonly email: string | null;
}

export interface Refusal {
  readonly error: string;
  readonly status: number;
}

export type Outcome<T> = T | Refusal;

export interface EngineView {
  readonly name: string;
  readonly host: string;
  readonly accountId: string;
  readonly version: string;
  readonly previews: boolean;
}

export interface SpendView {
  readonly month: string;
  readonly spent: number;
  readonly cap: number | null;
}

export interface OrgDetail {
  readonly org: OrgRow;
  readonly latest: string | null;
  readonly removing: boolean;
  readonly engine: EngineView | null;
  readonly reachable: boolean;
  readonly spend: SpendView | null;
  readonly members: readonly (OrgMember & { readonly spent: number | null })[];
  readonly invites: readonly Invite[];
  readonly projects: readonly { readonly name: string; readonly spent: number | null; readonly cap: number | null }[] | null;
}

export interface PersonDetail {
  readonly user: UserRow;
  readonly orgs: readonly (OrgSummary & { readonly engine: string | null })[];
  readonly install: InstallStatus | null;
  readonly removal: RemovalStatus | null;
}

const refuse = (error: string, status: number): Refusal => ({ error, status });
const NOT_ADMIN = refuse("only PlaygrndLabs admins can use the backoffice", 403);
const NO_ORG = refuse("there is no organization with that id", 404);
const TICKET = /^(usr_[A-Za-z0-9]{20})\.([A-Za-z0-9_-]{32,64})$/;

const thisMonth = () => new Date().toISOString().slice(0, 7);

const spentIn = (spending: Spending | null, pick: (ledger: Spending["ledger"]) => number | undefined): number | null => {
  if (!spending) return null;
  return spending.ledger.month === thisMonth() ? (pick(spending.ledger) ?? 0) : 0;
};

export class Backoffice extends WorkerEntrypoint<Env> {
  async redeem(ticket: string): Promise<Admin | null> {
    const match = TICKET.exec(ticket);
    if (!match) return null;
    const [, userId, value] = match as unknown as [string, string, string];
    const person = member(this.env, userId);
    if (!(await person.redeemTicket(value)) || !(await person.admin())) return null;
    return { userId, email: await person.email() };
  }

  async me(adminId: string): Promise<Outcome<Admin>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    return { userId: adminId, email: await member(this.env, adminId).email() };
  }

  async directory(adminId: string): Promise<Outcome<Directory>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    return directory(this.env).list();
  }

  async org(adminId: string, orgId: string): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    return this.detail(orgId);
  }

  async person(adminId: string, userId: string): Promise<Outcome<PersonDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    if (!isId(userId, "usr")) return refuse("there is no person with that id", 404);
    const all = await directory(this.env).list();
    const user = all.users.find((u) => u.id === userId);
    if (!user) return refuse("there is no person with that id", 404);
    const engines = new Map(all.orgs.map((o) => [o.id, o.engine]));
    const person = member(this.env, userId);
    const [orgs, install, removal] = await Promise.all([directory(this.env).orgs(userId), person.status(), person.removal()]);
    return { user, orgs: orgs.map((o) => ({ ...o, engine: engines.get(o.id) ?? null })), install: install.status === "idle" ? null : install, removal };
  }

  async renameOrg(adminId: string, orgId: string, name: unknown): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    const row = await this.row(orgId);
    if (!row) return NO_ORG;
    if (row.personal) return refuse("a Personal workspace keeps its name", 400);
    const clean = readOrgName({ name });
    if (!clean) return refuse("give the organization a name of up to 60 characters", 400);
    await organization(this.env, orgId).rename(clean);
    await directory(this.env).renameOrg(orgId, clean);
    return this.detail(orgId);
  }

  async setRole(adminId: string, orgId: string, userId: string, role: unknown): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    const row = await this.row(orgId);
    if (!row) return NO_ORG;
    if (row.personal) return refuse("a Personal workspace has only its owner", 400);
    if (!isRole(role)) return refuse("pick owner, admin or member", 400);
    if (!(await organization(this.env, orgId).setRole(userId, role))) return refuse("that person is not a member, or is the last owner", 409);
    await directory(this.env).setRole(orgId, userId, role as Role);
    return this.detail(orgId);
  }

  async removeMember(adminId: string, orgId: string, userId: string): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    const row = await this.row(orgId);
    if (!row) return NO_ORG;
    if (row.personal) return refuse("a Personal workspace has only its owner", 400);
    if (!(await organization(this.env, orgId).removeMember(userId))) return refuse("that person is not a member, or is the last owner", 409);
    await directory(this.env).removeMember(orgId, userId);
    return this.detail(orgId);
  }

  async cancelInvite(adminId: string, orgId: string, email: unknown): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    if (!(await this.row(orgId))) return NO_ORG;
    const clean = readEmail(email);
    if (!clean) return refuse("give an email address", 400);
    await directory(this.env).cancelInvite(orgId, clean);
    return this.detail(orgId);
  }

  async setBudget(adminId: string, orgId: string, dollars: unknown): Promise<Outcome<OrgDetail>> {
    if (!(await this.isAdmin(adminId))) return NOT_ADMIN;
    if (!(await this.row(orgId))) return NO_ORG;
    if (dollars !== null && (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000)) return refuse("a budget is a dollar amount from 0 to 1,000,000, or empty for no limit", 400);
    const engine = await organization(this.env, orgId).engine();
    if (!engine) return refuse("chef is not set up for this organization yet", 409);
    if (!(await setEngineBudget(engine, dollars))) return refuse("this organization's chef did not answer, so its budget stays as it was", 502);
    return this.detail(orgId);
  }

  private async isAdmin(adminId: string): Promise<boolean> {
    return isId(adminId, "usr") && (await member(this.env, adminId).admin());
  }

  private async row(orgId: string): Promise<OrgRow | null> {
    if (!isId(orgId, "org")) return null;
    return (await directory(this.env).list()).orgs.find((o) => o.id === orgId) ?? null;
  }

  private async detail(orgId: string): Promise<Outcome<OrgDetail>> {
    if (!isId(orgId, "org")) return NO_ORG;
    const all = await directory(this.env).list();
    const row = all.orgs.find((o) => o.id === orgId);
    if (!row) return NO_ORG;
    const org = organization(this.env, orgId);
    const [members, invites, engine, removing] = await Promise.all([org.members(), directory(this.env).invites(orgId), org.engine(), org.removing()]);
    const [names, spending] = engine ? await Promise.all([engineProjects(engine), engineSpending(engine)]) : [null, null];
    return {
      org: row,
      latest: all.latest,
      removing,
      engine: engine ? { name: engine.name, host: new URL(engine.url).host, accountId: engine.accountId, version: engine.version, previews: engine.previews !== false } : null,
      reachable: engine !== null && names !== null,
      spend: spending ? { month: thisMonth(), spent: spentIn(spending, (l) => l.org) ?? 0, cap: spending.caps.org } : null,
      members: members.map((m) => ({ ...m, spent: spentIn(spending, (l) => l.members[m.userId]) })),
      invites,
      projects: names ? names.map((name) => ({ name, spent: spentIn(spending, (l) => l.projects[name]), cap: spending?.caps.projects[name] ?? null })) : null,
    };
  }
}
