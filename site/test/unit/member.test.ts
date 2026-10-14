import { afterEach, describe, expect, it, vi } from "vitest";
import { Members } from "../../src/directory.ts";
import type { Env } from "../../src/env.ts";
import { Member, type Engine } from "../../src/member.ts";
import { Organization } from "../../src/organization.ts";
import { account, ACCOUNT, cloudflare, E } from "../support/cloudflare.ts";
import { FakeStorage } from "../support/durable-object.ts";

function world() {
  const orgs = new Map<string, Organization>();
  const env = {
    CF_ACCOUNT_ID: "site-account",
    SANDBOX_IMAGE: "registry.cloudflare.com/site-account/chef-sandbox:v9",
    OAUTH_CLIENT_ID: "abc",
    OAUTH_CLIENT_SECRET: "shh",
    OAUTH_SCOPES: "s.read",
  } as Record<string, unknown>;
  const dir = new Members({ storage: new FakeStorage() } as unknown as DurableObjectState, env as unknown as Env);
  env["MEMBERS"] = { idFromName: (name: string) => name, get: () => dir };
  env["ORG"] = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!orgs.has(id)) orgs.set(id, new Organization({ storage: new FakeStorage() } as unknown as DurableObjectState, env as unknown as Env));
      return orgs.get(id);
    },
  };
  const storage = new FakeStorage();
  const member = new Member({ storage } as unknown as DurableObjectState, env as unknown as Env);
  return { env, dir, org: (id: string) => (env["ORG"] as { get: (id: string) => Organization }).get(id), member, storage };
}

const engine: Engine = { name: E, url: "https://chef-acme-x7k2.acme.workers.dev", accountId: ACCOUNT, secret: "s", version: "v9" };
const profile = { id: "cf-sam", email: "sam@example.com" };

afterEach(() => vi.unstubAllGlobals());

async function setUp() {
  const w = world();
  const signed = w.dir.signIn({ provider: "cloudflare", subject: "cf-sam", email: "sam@example.com" }, false);
  const team = w.dir.createOrg(signed.userId, "Acme");
  await w.org(team.id).setup({ id: team.id, name: "Acme", personal: false }, { userId: signed.userId, email: "sam@example.com", role: "owner" });
  await w.org(team.id).setEngine(engine);
  w.org(team.id).claimProject(signed.userId, "shop");
  await w.member.signIn(profile, { token: "tok", expiresAt: Date.now() + 600_000 }, false, { id: team.id, canSetUp: true, engine }, true);
  return { ...w, userId: signed.userId, personal: signed.org, team };
}

describe("removing chef for an organization", () => {
  it("removes chef from Cloudflare, deletes the organization and hands back the Cloudflare access", async () => {
    const w = await setUp();
    const state = account();
    const { fetcher, deleted } = cloudflare(state);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : String(input);
      calls.push(`${init?.method ?? (input instanceof Request ? input.method : "GET")} ${target}`);
      if (target.startsWith("https://dash.cloudflare.com/")) return new Response(null, { status: 200 });
      return fetcher(input, init);
    }));
    const started = await w.member.remove({ orgId: w.team.id, orgName: "Acme", personal: false, engine, projects: ["shop", "blog"] });
    expect(started).toMatchObject({ status: "running", orgName: "Acme" });
    expect(await w.org(w.team.id).removing()).toBe(true);
    expect(await w.member.install({ orgId: w.team.id, orgName: "Acme", accountId: ACCOUNT, engine })).toBe("chef is being removed; wait until that finishes");
    await w.member.alarm();
    const done = await w.member.removal();
    expect(done).toMatchObject({ status: "done", error: null, left: [], steps: { find: "done", engine: "done", apps: "done", data: "done", org: "done" } });
    expect(done?.log).toContain(`removed chef's engine ${E}`);
    expect(deleted).toContain(`/workers/scripts/${E}?force=true`);
    expect(state.scripts.map((s) => s.id)).not.toContain(E);
    expect(w.dir.orgs(w.userId)).toEqual([w.personal]);
    expect(await w.org(w.team.id).access(w.userId)).toBeNull();
    expect(calls.at(-1)).toBe("POST https://dash.cloudflare.com/oauth2/revoke");
    await w.member.dismissRemoval();
    expect(await w.member.removal()).toBeNull();
  });

  it("keeps the organization and says why when Cloudflare will not show the account", async () => {
    const w = await setUp();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 })));
    await w.member.remove({ orgId: w.team.id, orgName: "Acme", personal: false, engine, projects: null });
    await w.member.alarm();
    const failed = await w.member.removal();
    expect(failed).toMatchObject({ status: "failed", steps: { find: "failed", org: "waiting" } });
    expect(failed?.error).toMatch(/did not let chef list the Workers/);
    expect(await w.org(w.team.id).engine()).toEqual(engine);
    expect(await w.org(w.team.id).removing()).toBe(false);
    expect(w.dir.orgs(w.userId).map((o) => o.name)).toEqual(["Personal", "Acme"]);
  });

  it("resets Personal instead of deleting it", async () => {
    const w = await setUp();
    await w.org(w.personal.id).setup({ id: w.personal.id, name: "Personal", personal: true }, { userId: w.userId, email: "sam@example.com", role: "owner" });
    await w.org(w.personal.id).setEngine(engine);
    const { fetcher } = cloudflare(account(false));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => ((input instanceof Request ? input.url : String(input)).startsWith("https://dash.") ? new Response(null) : fetcher(input, init))));
    await w.member.remove({ orgId: w.personal.id, orgName: "Personal", personal: true, engine, projects: [] });
    await w.member.alarm();
    expect(await w.member.removal()).toMatchObject({ status: "done", steps: { org: "done" } });
    expect(await w.org(w.personal.id).access(w.userId)).toMatchObject({ role: "owner", engine: null });
    expect(w.dir.orgs(w.userId).map((o) => o.name)).toEqual(["Personal", "Acme"]);
  });

  it("deletes an organization that never set chef up without asking for Cloudflare", async () => {
    const w = await setUp();
    const empty = w.dir.createOrg(w.userId, "Empty");
    await w.org(empty.id).setup({ id: empty.id, name: "Empty", personal: false }, { userId: w.userId, email: "sam@example.com", role: "owner" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no Cloudflare call expected");
    }));
    expect(await w.member.remove({ orgId: empty.id, orgName: "Empty", personal: false, engine: null, projects: null })).toMatchObject({ status: "done", accountId: null });
    expect(w.dir.orgs(w.userId).map((o) => o.name)).toEqual(["Personal", "Acme"]);
  });
});
