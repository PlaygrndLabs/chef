import { afterEach, describe, expect, it, vi } from "vitest";
import { Backoffice, type OrgDetail, type Outcome } from "../../src/backoffice.ts";
import { Members } from "../../src/directory.ts";
import type { Env } from "../../src/env.ts";
import { Member, type Engine } from "../../src/member.ts";
import { Organization } from "../../src/organization.ts";
import { FakeStorage } from "../support/durable-object.ts";

const month = new Date().toISOString().slice(0, 7);
const engine: Engine = { name: "chef-acme-x7k2", url: "https://chef-acme-x7k2.acme.workers.dev", accountId: "acc", secret: "engine-secret", version: "v1" };

function world() {
  const env = { ENGINE_VERSION: "v2" } as Record<string, unknown>;
  const dir = new Members({ storage: new FakeStorage() } as unknown as DurableObjectState, env as unknown as Env);
  const orgs = new Map<string, Organization>();
  const members = new Map<string, { member: Member; storage: FakeStorage }>();
  const person = (id: string) => {
    if (!members.has(id)) {
      const storage = new FakeStorage();
      members.set(id, { member: new Member({ storage } as unknown as DurableObjectState, env as unknown as Env), storage });
    }
    return members.get(id) as { member: Member; storage: FakeStorage };
  };
  env["MEMBERS"] = { idFromName: (name: string) => name, get: () => dir };
  env["ORG"] = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!orgs.has(id)) orgs.set(id, new Organization({ storage: new FakeStorage() } as unknown as DurableObjectState, env as unknown as Env));
      return orgs.get(id);
    },
  };
  env["MEMBER"] = { idFromName: (name: string) => name, get: (id: string) => person(id).member };
  const org = (id: string) => (env["ORG"] as { get: (id: string) => Organization }).get(id);
  return { env: env as unknown as Env, dir, org, person, office: new Backoffice({} as ExecutionContext, env as unknown as Env) };
}

async function setUp() {
  const w = world();
  const boss = w.dir.signIn({ provider: "cloudflare", subject: "cf-boss", email: "boss@playgrndlabs.com" }, true);
  await w.person(boss.userId).storage.put("admin", true);
  await w.person(boss.userId).storage.put("profile", { id: "cf-boss", email: "boss@playgrndlabs.com" });
  const sam = w.dir.signIn({ provider: "cloudflare", subject: "cf-sam", email: "sam@example.com" }, false);
  const kim = w.dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: "kim@example.com" }, false);
  const team = w.dir.createOrg(sam.userId, "Acme");
  await w.org(team.id).setup({ id: team.id, name: "Acme", personal: false }, { userId: sam.userId, email: "sam@example.com", role: "owner" });
  w.dir.invite(team.id, "kim@example.com", "member", sam.userId);
  await w.org(team.id).setup({ id: team.id, name: "", personal: false }, { userId: kim.userId, email: "kim@example.com", role: "member" });
  w.dir.invite(team.id, "lee@example.com", "admin", sam.userId);
  await w.org(team.id).setEngine(engine);
  return { ...w, boss: boss.userId, sam: sam.userId, samPersonal: sam.org.id, kim: kim.userId, team: team.id };
}

const detail = (outcome: Outcome<OrgDetail>) => {
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome;
};

function engineAnswers(spending: { caps: { org: number | null; projects: Record<string, number>; members: Record<string, number> }; ledger: { month: string; org: number; projects: Record<string, number>; members: Record<string, number> } } = { caps: { org: 50_000_000, projects: { shop: 5_000_000 }, members: {} }, ledger: { month, org: 2_500_000, projects: { shop: 2_000_000 }, members: {} } }) {
  const calls: { url: string; method: string; auth: string | null; body: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization"), body: (init.body as string | undefined) ?? null });
      if (url.endsWith("/api/projects")) return Response.json({ projects: [{ name: "shop" }, { name: "blog" }] });
      if (init.method === "PUT") spending = { ...spending, caps: { ...spending.caps, org: (JSON.parse(init.body as string) as { org: number | null }).org === null ? null : 75_000_000 } };
      return Response.json(spending);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("backoffice", () => {
  it("lets an admin in once per ticket, and only an admin", async () => {
    const w = await setUp();
    const ticket = await w.person(w.boss).member.backofficeTicket();
    expect(await w.office.redeem(`${w.boss}.${ticket}`)).toEqual({ userId: w.boss, email: "boss@playgrndlabs.com" });
    expect(await w.office.redeem(`${w.boss}.${ticket}`)).toBeNull();
    const guess = await w.person(w.boss).member.backofficeTicket();
    expect(await w.office.redeem(`${w.boss}.${"x".repeat(43)}`)).toBeNull();
    expect(await w.office.redeem(`${w.boss}.${guess}`)).toBeNull();
    const samTicket = await w.person(w.sam).member.backofficeTicket();
    expect(await w.office.redeem(`${w.sam}.${samTicket}`)).toBeNull();
    expect(await w.office.redeem("nonsense")).toBeNull();
    const late = await w.person(w.boss).member.backofficeTicket();
    await w.person(w.boss).storage.put("backoffice-ticket", { value: late, expiresAt: Date.now() - 1 });
    expect(await w.office.redeem(`${w.boss}.${late}`)).toBeNull();
  });

  it("refuses everyone who is not an admin", async () => {
    const w = await setUp();
    for (const outcome of [await w.office.directory(w.sam), await w.office.org(w.sam, w.team), await w.office.me("usr_nope"), await w.office.renameOrg(w.kim, w.team, "Mine")]) {
      expect(outcome).toEqual({ error: "only PlaygrndLabs admins can use the backoffice", status: 403 });
    }
    expect(await w.office.me(w.boss)).toEqual({ userId: w.boss, email: "boss@playgrndlabs.com" });
  });

  it("shows an organization with its engine, people, invitations, projects and spend, but never its key", async () => {
    const w = await setUp();
    const calls = engineAnswers();
    const org = detail(await w.office.org(w.boss, w.team));
    expect(org.org).toMatchObject({ name: "Acme", personal: false, owner: "sam@example.com", members: 2 });
    expect(org.latest).toBe("v2");
    expect(org.engine).toEqual({ name: "chef-acme-x7k2", host: "chef-acme-x7k2.acme.workers.dev", accountId: "acc", version: "v1", previews: true });
    expect(org.reachable).toBe(true);
    expect(org.spend).toEqual({ month, spent: 2_500_000, cap: 50_000_000 });
    expect(org.members.map((m) => [m.email, m.role, m.spent])).toEqual([["sam@example.com", "owner", 0], ["kim@example.com", "member", 0]]);
    expect(org.invites).toMatchObject([{ email: "lee@example.com", role: "admin" }]);
    expect(org.projects).toEqual([{ name: "shop", spent: 2_000_000, cap: 5_000_000 }, { name: "blog", spent: 0, cap: null }]);
    expect(JSON.stringify(org)).not.toContain("engine-secret");
    expect(calls.every((c) => c.auth === "Bearer engine-secret")).toBe(true);
    expect(await w.office.org(w.boss, "org_missingmissingmiss")).toMatchObject({ status: 404 });
  });

  it("still shows an organization whose chef does not answer", async () => {
    const w = await setUp();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    const org = detail(await w.office.org(w.boss, w.team));
    expect(org).toMatchObject({ reachable: false, spend: null, projects: null });
    expect(org.members.map((m) => m.spent)).toEqual([null, null]);
  });

  it("renames organizations, changes roles, removes people and cancels invitations, keeping the rules the site keeps", async () => {
    const w = await setUp();
    engineAnswers();
    expect(await w.office.renameOrg(w.boss, w.samPersonal, "Sam's")).toMatchObject({ status: 400 });
    expect(await w.office.renameOrg(w.boss, w.team, " ")).toMatchObject({ status: 400 });
    expect(detail(await w.office.renameOrg(w.boss, w.team, "Acme Labs")).org.name).toBe("Acme Labs");
    expect((await w.org(w.team).view(w.sam))?.name).toBe("Acme Labs");
    expect(await w.office.setRole(w.boss, w.team, w.sam, "member")).toMatchObject({ status: 409 });
    expect(await w.office.setRole(w.boss, w.team, w.kim, "boss")).toMatchObject({ status: 400 });
    expect(detail(await w.office.setRole(w.boss, w.team, w.kim, "admin")).members.find((m) => m.userId === w.kim)?.role).toBe("admin");
    expect(w.dir.orgs(w.kim).find((o) => o.id === w.team)?.role).toBe("admin");
    expect(await w.office.removeMember(w.boss, w.team, w.sam)).toMatchObject({ status: 409 });
    expect(await w.office.removeMember(w.boss, w.samPersonal, w.sam)).toMatchObject({ status: 400 });
    expect(detail(await w.office.removeMember(w.boss, w.team, w.kim)).members.map((m) => m.userId)).toEqual([w.sam]);
    expect(w.dir.orgs(w.kim).some((o) => o.id === w.team)).toBe(false);
    expect(detail(await w.office.cancelInvite(w.boss, w.team, "LEE@example.com")).invites).toEqual([]);
  });

  it("sets an organization's monthly budget on its chef", async () => {
    const w = await setUp();
    const calls = engineAnswers();
    expect(await w.office.setBudget(w.boss, w.team, -1)).toMatchObject({ status: 400 });
    expect(await w.office.setBudget(w.boss, w.samPersonal, 10)).toMatchObject({ status: 409 });
    expect(detail(await w.office.setBudget(w.boss, w.team, 75)).spend?.cap).toBe(75_000_000);
    expect(calls).toContainEqual({ url: `${engine.url}/api/usage`, method: "PUT", auth: "Bearer engine-secret", body: JSON.stringify({ org: 75 }) });
    expect(detail(await w.office.setBudget(w.boss, w.team, null)).spend?.cap).toBeNull();
  });

  it("shows a person with their organizations", async () => {
    const w = await setUp();
    const person = await w.office.person(w.boss, w.sam);
    if ("error" in person) throw new Error(person.error);
    expect(person.user).toMatchObject({ email: "sam@example.com", admin: false, orgs: 2 });
    expect(person.orgs.map((o) => [o.name, o.role, o.personal, o.engine])).toEqual([["Personal", "owner", true, null], ["Acme", "owner", false, null]]);
    expect(person).toMatchObject({ install: null, removal: null });
    expect(await w.office.person(w.boss, "usr_missingmissingmiss")).toMatchObject({ status: 404 });
  });
});
