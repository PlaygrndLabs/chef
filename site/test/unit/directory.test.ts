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
  it("gives a new person one default organization they own and keeps it on later sign-ins", () => {
    const dir = directory();
    const first = dir.signIn(sam, false);
    expect(first.userId).toMatch(/^usr_[A-Za-z0-9]{20}$/);
    expect(first.created).toBe(true);
    expect(first.org).toMatchObject({ name: "sam's org", role: "owner" });
    expect(first.org.id).toMatch(/^org_[A-Za-z0-9]{20}$/);
    const again = dir.signIn({ ...sam, email: "sam@new.example" }, true);
    expect(again).toEqual({ userId: first.userId, created: false, org: first.org, orgs: [first.org] });
    expect(dir.list().users).toMatchObject([{ id: first.userId, email: "sam@new.example", admin: true, orgs: 1 }]);
  });

  it("remembers the organization a person last used", () => {
    const dir = directory();
    const { userId, org } = dir.signIn(sam, false);
    const team = dir.createOrg(userId, "Acme");
    expect(dir.orgs(userId)).toEqual([org, team]);
    expect(dir.use(userId, team.id)).toEqual(team);
    expect(dir.use(userId, "org_missing")).toBeNull();
    expect(dir.signIn(sam, false).org).toEqual(team);
  });

  it("keeps each person's organizations apart and lists them for admins", () => {
    const dir = directory();
    const a = dir.signIn(sam, false);
    const b = dir.signIn({ provider: "cloudflare", subject: "cf-kim", email: null }, false);
    expect(b.org.name).toBe("My org");
    expect(dir.use(a.userId, b.org.id)).toBeNull();
    dir.renameOrg(a.org.id, "Sam and co");
    dir.recordSetup(a.org.id, { accountId: "acct", engine: "https://chef.sam.workers.dev", version: "v1", install: "done", error: null });
    const list = dir.list();
    expect(list.latest).toBe("v2");
    expect(list.orgs.find((o) => o.id === a.org.id)).toMatchObject({ name: "Sam and co", owner: "sam@example.com", members: 1, accountId: "acct", install: "done" });
  });
});

describe("organization", () => {
  it("lets only its members in and keeps the engine with the organization", async () => {
    const org = organization();
    await org.setup({ id: "org1", name: "Acme" }, { userId: "usr1", email: "sam@example.com", role: "owner" });
    await org.setup({ id: "org1", name: "ignored" }, { userId: "usr2", email: null, role: "member" });
    expect(await org.access("usr3")).toBeNull();
    expect(await org.access("usr2")).toEqual({ role: "member", engine: null });
    const engine = { name: "chef-acme-ab12", url: "https://chef.acme.workers.dev", accountId: "acct", secret: "s", version: "v1" };
    await org.setEngine(engine);
    expect(await org.access("usr1")).toEqual({ role: "owner", engine });
    await org.rename("Acme Labs");
    expect(await org.view("usr1")).toEqual({ id: "org1", name: "Acme Labs", role: "owner", engine: engine.url, members: 2 });
    expect((await org.members()).map((m) => [m.userId, m.role])).toEqual([["usr1", "owner"], ["usr2", "member"]]);
  });
});

describe("engine names", () => {
  it("gives each organization's chef its own Worker name on a shared Cloudflare account", () => {
    const rolls = [0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99];
    const random = () => rolls.shift() ?? 0.5;
    expect(engineName("Sam's Org!", new Set(), () => 0)).toBe("chef-sam-s-org-aaaa");
    expect(engineName("Sam's Org!", new Set(["chef-sam-s-org-aaaa"]), random)).toBe("chef-sam-s-org-9999");
    expect(engineName("   ", new Set(), () => 0)).toBe("chef-org-aaaa");
    expect(engineName("A very long organization name indeed", new Set(), () => 0)).toBe("chef-a-very-long-organiza-aaaa");
  });
});
