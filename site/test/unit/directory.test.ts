import { describe, expect, it } from "vitest";
import { Members } from "../../src/directory.ts";
import type { Env } from "../../src/env.ts";
import { Organization } from "../../src/organization.ts";
import { engineName } from "../../src/orgs.ts";
import { FakeStorage } from "../support/durable-object.ts";

const directory = () => new Members({ storage: new FakeStorage() } as unknown as DurableObjectState, { ENGINE_VERSION: "v2" } as unknown as Env);
const organization = () => new Organization({ storage: new FakeStorage() } as unknown as DurableObjectState, {} as Env);
const sam = { provider: "cloudflare", subject: "cf-sam", email: "sam@example.com" } as const;

describe("directory", () => {
  it("gives a new person a Personal workspace they own and keeps it on later sign-ins", () => {
    const dir = directory();
    const first = dir.signIn(sam, false);
    expect(first.userId).toMatch(/^usr_[A-Za-z0-9]{20}$/);
    expect(first.org).toMatchObject({ name: "Personal", role: "owner", personal: true, plan: "free" });
    expect(first.org.id).toMatch(/^org_[A-Za-z0-9]{20}$/);
    const again = dir.signIn({ ...sam, email: "sam@new.example" }, true);
    expect(again).toEqual({ userId: first.userId, org: first.org, orgs: [first.org], joined: [] });
    expect(dir.list().users).toMatchObject([{ id: first.userId, email: "sam@new.example", admin: true, orgs: 1 }]);
  });

  it("remembers the organization a person last used", () => {
    const dir = directory();
    const { userId, org } = dir.signIn(sam, false);
    const team = dir.createOrg(userId, "Acme");
    expect(team).toMatchObject({ name: "Acme", role: "owner", personal: false, plan: "free" });
    expect(dir.orgs(userId)).toEqual([org, team]);
    expect(dir.use(userId, team.id)).toEqual(team);
    expect(dir.use(userId, "org_missing")).toBeNull();
    expect(dir.signIn(sam, false).org).toEqual(team);
  });

  it("keeps each person's organizations apart and lists them for admins", () => {
    const dir = directory();
    const a = dir.signIn(sam, false);
    const b = dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: null }, false);
    expect(b.org).toMatchObject({ name: "Personal", personal: true });
    expect(b.org.id).not.toBe(a.org.id);
    expect(dir.use(a.userId, b.org.id)).toBeNull();
    dir.renameOrg(a.org.id, "Sam and co");
    dir.recordSetup(a.org.id, { accountId: "acct", engine: "https://chef.sam.workers.dev", version: "v1", install: "done", error: null });
    const list = dir.list();
    expect(list.latest).toBe("v2");
    expect(list.orgs.find((o) => o.id === a.org.id)).toMatchObject({ name: "Sam and co", personal: true, owner: "sam@example.com", members: 1, accountId: "acct", install: "done" });
  });
});

describe("invitations", () => {
  it("adds people who already use chef at once and the rest when they first sign in", () => {
    const dir = directory();
    const sam1 = dir.signIn(sam, false);
    const team = dir.createOrg(sam1.userId, "Acme");
    const kim = dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: "kim@example.com" }, false);
    expect(dir.invite(team.id, "kim@example.com", "admin", sam1.userId)).toEqual({ status: "added", userId: kim.userId });
    expect(dir.invite(team.id, "kim@example.com", "member", sam1.userId)).toEqual({ status: "member" });
    expect(dir.orgs(kim.userId).map((o) => [o.name, o.role])).toEqual([["Personal", "owner"], ["Acme", "admin"]]);
    expect(dir.invite(team.id, "lee@example.com", "member", sam1.userId)).toEqual({ status: "invited" });
    expect(dir.invites(team.id)).toMatchObject([{ email: "lee@example.com", role: "member" }]);
    const lee = dir.signIn({ provider: "cloudflare", subject: "cf-lee", email: "Lee@Example.com" }, false);
    expect(lee.joined).toMatchObject([{ id: team.id, name: "Acme", role: "member", personal: false }]);
    expect(dir.invites(team.id)).toEqual([]);
    dir.setRole(team.id, lee.userId, "admin");
    dir.removeMember(team.id, kim.userId);
    expect(dir.orgs(lee.userId).map((o) => [o.name, o.role])).toEqual([["Personal", "owner"], ["Acme", "admin"]]);
    expect(dir.orgs(kim.userId).map((o) => o.name)).toEqual(["Personal"]);
  });
});

describe("project access", () => {
  const setUp = async () => {
    const org = organization();
    await org.setup({ id: "org1", name: "Acme", personal: false }, { userId: "own", email: "own@example.com", role: "owner" });
    await org.setup({ id: "org1", name: "Acme", personal: false }, { userId: "kim", email: "kim@example.com", role: "member" });
    await org.setup({ id: "org1", name: "Acme", personal: false }, { userId: "lee", email: "lee@example.com", role: "member" });
    return org;
  };

  it("keeps a new project private to its maker and to owners and admins", async () => {
    const org = await setUp();
    expect(await org.claimProject("kim", "shop")).toBe(true);
    expect(await org.levels("kim", ["shop", "other"])).toEqual({ shop: "manage" });
    expect(await org.levels("lee", ["shop"])).toEqual({});
    expect(await org.levels("own", ["shop", "other"])).toEqual({ shop: "manage", other: "manage" });
    expect(await org.claimProject("lee", "shop")).toBe(false);
    expect((await org.access("lee", "shop"))?.level).toBeNull();
  });

  it("shares with the whole organization or with chosen people", async () => {
    const org = await setUp();
    await org.claimProject("kim", "shop");
    expect((await org.share("kim", "shop", "org", "view")).visibility).toBe("org");
    expect((await org.access("lee", "shop"))?.level).toBe("view");
    const sharing = await org.setLevel("kim", "shop", "lee", "edit");
    expect(sharing?.people.map((p) => [p.email, p.level])).toEqual([["kim@example.com", "manage"], ["lee@example.com", "edit"]]);
    expect((await org.access("lee", "shop"))?.level).toBe("edit");
    expect(await org.setLevel("kim", "shop", "stranger", "edit")).toBeNull();
    await org.share("kim", "shop", "private", "edit");
    await org.setLevel("kim", "shop", "lee", null);
    expect((await org.access("lee", "shop"))?.level).toBeNull();
  });

  it("keeps at least one owner and forgets removed people's projects", async () => {
    const org = await setUp();
    await org.claimProject("kim", "shop");
    await org.setLevel("kim", "shop", "lee", "view");
    expect(await org.removeMember("own")).toBe(false);
    expect(await org.setRole("own", "member")).toBe(false);
    expect(await org.setRole("kim", "owner")).toBe(true);
    expect(await org.setRole("own", "member")).toBe(true);
    expect(await org.removeMember("lee")).toBe(true);
    expect((await org.sharing("shop")).people.map((p) => p.userId)).toEqual(["kim"]);
    expect(await org.access("lee", "shop")).toBeNull();
  });
});

describe("organization", () => {
  it("lets only its members in and keeps the engine with the organization", async () => {
    const org = organization();
    await org.setup({ id: "org1", name: "Acme", personal: false }, { userId: "usr1", email: "sam@example.com", role: "owner" });
    await org.setup({ id: "org1", name: "ignored", personal: true }, { userId: "usr2", email: null, role: "member" });
    expect(await org.access("usr3")).toBeNull();
    expect(await org.access("usr2")).toEqual({ role: "member", engine: null, level: null, updating: false });
    const engine = { name: "chef-acme-ab12", url: "https://chef.acme.workers.dev", accountId: "acct", secret: "s", version: "v1" };
    await org.setEngine(engine);
    expect(await org.access("usr1")).toEqual({ role: "owner", engine, level: null, updating: false });
    await org.rename("Acme Labs");
    expect(await org.view("usr1")).toEqual({ id: "org1", name: "Acme Labs", role: "owner", personal: false, plan: "free", engine: engine.url, members: 2 });
    expect((await org.members()).map((m) => [m.userId, m.role])).toEqual([["usr1", "owner"], ["usr2", "member"]]);
  });
});

describe("engine names", () => {
  it("deletes an organization for everyone in it but never anyone's Personal", () => {
    const dir = directory();
    const sam1 = dir.signIn(sam, false);
    const kim = dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: "kim@example.com" }, false);
    const team = dir.createOrg(sam1.userId, "Acme");
    dir.invite(team.id, "kim@example.com", "member", sam1.userId);
    dir.invite(team.id, "lee@example.com", "admin", sam1.userId);
    dir.use(kim.userId, team.id);
    expect(dir.deleteOrg(sam1.org.id)).toBe(false);
    expect(dir.deleteOrg(team.id)).toBe(true);
    expect(dir.orgs(sam1.userId)).toEqual([sam1.org]);
    expect(dir.orgs(kim.userId)).toEqual([kim.org]);
    expect(dir.invites(team.id)).toEqual([]);
    expect(dir.list().orgs.map((o) => o.id)).not.toContain(team.id);
    expect(dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: "kim@example.com" }, false).org).toEqual(kim.org);
    expect(dir.home(sam1.userId)).toEqual(sam1.org);
  });

  it("forgets an organization's chef, projects and people when it is deleted or uninstalled", async () => {
    const org = organization();
    await org.setup({ id: "org_a", name: "Acme", personal: false }, { userId: "usr_a", email: "a@example.com", role: "owner" });
    await org.setEngine({ name: "chef-acme-x7k2", url: "https://e", accountId: "acc", secret: "s", version: "v" });
    org.claimProject("usr_a", "shop");
    await org.setRemoving(true);
    expect(await org.removing()).toBe(true);
    await org.reset();
    expect(await org.engine()).toBeNull();
    expect(await org.removing()).toBe(false);
    expect(org.sharing("shop").people).toEqual([]);
    expect(await org.access("usr_a")).toMatchObject({ role: "owner", engine: null });
    await org.erase();
    expect(await org.access("usr_a")).toBeNull();
    expect(await org.view("usr_a")).toBeNull();
  });

  it("gives each organization's chef its own Worker name on a shared Cloudflare account", () => {
    const rolls = [0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99];
    const random = () => rolls.shift() ?? 0.5;
    expect(engineName("Sam's Org!", new Set(), () => 0)).toBe("chef-sam-s-org-aaaa");
    expect(engineName("Sam's Org!", new Set(["chef-sam-s-org-aaaa"]), random)).toBe("chef-sam-s-org-9999");
    expect(engineName("   ", new Set(), () => 0)).toBe("chef-org-aaaa");
    expect(engineName("A very long organization name indeed", new Set(), () => 0)).toBe("chef-a-very-long-organiza-aaaa");
  });
});
