import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";
import { signSession } from "../../src/oauth.ts";
import type { Role } from "../../src/orgs.ts";

interface OrgState {
  name: string;
  engine: { url: string; secret: string; accountId?: string; version?: string } | null;
  members: Record<string, Role>;
}

interface Fake {
  orgs: Record<string, OrgState>;
  admins: string[];
  legacy: Record<string, { url: string; secret: string; accountId: string; version: string }>;
  calls: { name: string; method: string; arg?: unknown }[];
}

const ENGINE = { url: "https://chef.sam.workers.dev", secret: "engine-secret" };

function fakeEnv(state: Partial<Fake> & { engine?: OrgState["engine"]; role?: Role } = {}, withClient = true) {
  const fake: Fake = { orgs: { org1: { name: "sam's org", engine: state.engine ?? null, members: { user1: state.role ?? "owner", boss: "owner" } } }, admins: [], legacy: {}, calls: [], ...state };
  const summaries = (userId: string) => Object.entries(fake.orgs).flatMap(([id, org]) => (org.members[userId] ? [{ id, name: org.name, role: org.members[userId] }] : []));
  const member = (name: string) => ({
    signIn: async (profile: unknown, grant: unknown, admin: unknown, org: unknown) => void fake.calls.push({ name, method: "signIn", arg: { profile, grant, admin, org } }),
    admin: async () => fake.admins.includes(name),
    legacyEngine: async () => fake.legacy[name] ?? null,
    view: async () => ({ email: "sam@example.com", admin: fake.admins.includes(name), canSetUp: true, install: null }),
    accounts: async () => [{ id: "a1", name: "Mine", plan: "paid", subdomain: "mine" }],
    status: async () => ({ status: "idle" }),
    install: async (arg: unknown) => (fake.calls.push({ name, method: "install", arg }), { status: "running" }),
    dismiss: async () => undefined,
  });
  const org = (id: string) => ({
    setup: async (info: { name: string }, who: { userId: string; role: Role }) => {
      fake.calls.push({ name: id, method: "setup", arg: { info, who } });
      fake.orgs[id] ??= { name: info.name, engine: null, members: {} };
      fake.orgs[id].members[who.userId] = who.role;
    },
    access: async (userId: string) => (fake.orgs[id]?.members[userId] ? { role: fake.orgs[id].members[userId], engine: fake.orgs[id].engine } : null),
    view: async (userId: string) => (fake.orgs[id]?.members[userId] ? { id, name: fake.orgs[id].name, role: fake.orgs[id].members[userId], engine: fake.orgs[id].engine?.url ?? null, members: Object.keys(fake.orgs[id].members).length } : null),
    members: async () => Object.entries(fake.orgs[id]?.members ?? {}).map(([userId, role]) => ({ userId, role })),
    rename: async (name: string) => void ((fake.orgs[id] as OrgState).name = name),
    engine: async () => fake.orgs[id]?.engine ?? null,
    setEngine: async (engine: OrgState["engine"]) => void ((fake.orgs[id] as OrgState).engine = engine),
  });
  const dir = {
    signIn: async (identity: { subject: string; email: string }, admin: boolean) => {
      fake.calls.push({ name: "directory", method: "signIn", arg: { identity, admin } });
      return { userId: "usr_new", created: true, org: { id: "org_new", name: "sam's org", role: "owner" }, orgs: [{ id: "org_new", name: "sam's org", role: "owner" }] };
    },
    orgs: async (userId: string) => summaries(userId),
    createOrg: async (userId: string, name: string) => (fake.calls.push({ name: "directory", method: "createOrg", arg: { userId, name } }), { id: "org2", name, role: "owner" }),
    use: async (userId: string, orgId: string) => summaries(userId).find((o) => o.id === orgId) ?? null,
    renameOrg: async (orgId: string, name: string) => void fake.calls.push({ name: "directory", method: "renameOrg", arg: { orgId, name } }),
    recordSetup: async (orgId: string, setup: unknown) => void fake.calls.push({ name: "directory", method: "recordSetup", arg: { orgId, setup } }),
    list: async () => ({ latest: "v2", users: [{ id: "user1", email: "sam@example.com" }], orgs: [] }),
  };
  const env = {
    ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) },
    MEMBER: { idFromName: (name: string) => name, get: (name: string) => member(name) },
    MEMBERS: { idFromName: (name: string) => name, get: () => dir },
    ORG: { idFromName: (name: string) => name, get: (name: string) => org(name) },
    CF_ACCOUNT_ID: "site-account",
    ...(withClient ? { OAUTH_CLIENT_ID: "abc", OAUTH_CLIENT_SECRET: "shh", OAUTH_SCOPES: "s.read" } : {}),
  } as unknown as Env;
  return { env, fake };
}

const origin = "https://chef.example.com";
const session = async (user = "user1", orgId = "org1") => `chef_session=${await signSession("shh", { userId: user, orgId }, Date.now())}`;
const send = (path: string, method: string, body: unknown, cookie: string) => new Request(`${origin}${path}`, { method, body: JSON.stringify(body), headers: { origin, cookie, "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("chef site", () => {
  it("shows the landing page to visitors, the app to members with an engine and setup to the rest", async () => {
    expect(await (await handle(new Request(`${origin}/`), fakeEnv().env)).text()).toBe("asset /");
    expect(await (await handle(new Request(`${origin}/`, { headers: { cookie: await session() } }), fakeEnv({ engine: ENGINE }).env)).text()).toBe("asset /app");
    expect((await handle(new Request(`${origin}/`, { headers: { cookie: await session() } }), fakeEnv().env)).headers.get("location")).toBe("/setup");
    expect((await handle(new Request(`${origin}/setup`), fakeEnv().env)).headers.get("location")).toBe("/");
    expect(await (await handle(new Request(`${origin}/style.css`), fakeEnv().env)).text()).toBe("asset /style.css");
  });

  it("explains when sign-in is not configured yet", async () => {
    const response = await handle(new Request(`${origin}/auth/start`), fakeEnv({}, false).env);
    expect(response.headers.get("location")).toBe("/?signin=unavailable#get-started");
  });

  it("starts sign-in at Cloudflare and remembers the state for the callback only", async () => {
    const response = await handle(new Request(`${origin}/auth/start`), fakeEnv().env);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.host).toBe("dash.cloudflare.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/auth/callback`);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^chef_oauth=${location.searchParams.get("state")}\\.[\\w-]+; Path=/auth/callback;`));
  });

  it("refuses a callback whose state does not match", async () => {
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=other`, { headers: { cookie: "chef_oauth=mine.verifier" } }), fakeEnv().env);
    expect(response.headers.get("location")).toBe("/?signin=cancelled#get-started");
  });

  it("signs a new person in with a default organization they own and sends them to setup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input instanceof Request ? input.url : input);
      if (target.endsWith("/user")) return Response.json({ result: { id: "cfuser", email: "sam@example.com" } });
      if (target.includes("/accounts")) return Response.json({ result: [{ id: "mine" }] });
      return Response.json({ access_token: "tok", expires_in: 600 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env, fake } = fakeEnv();
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier" } }), env);
    expect(response.headers.get("location")).toBe("/setup");
    expect(fake.calls).toMatchObject([
      { name: "directory", method: "signIn", arg: { identity: { provider: "cloudflare", subject: "cfuser", email: "sam@example.com" }, admin: false } },
      { name: "org_new", method: "setup", arg: { info: { id: "org_new", name: "sam's org" }, who: { userId: "usr_new", role: "owner" } } },
      { name: "usr_new", method: "signIn", arg: { profile: { id: "cfuser" }, grant: { token: "tok" }, admin: false, org: { id: "org_new", canSetUp: true, engine: null } } },
    ]);
    expect(fake.orgs["org_new"]?.members).toEqual({ usr_new: "owner" });
    expect(response.headers.getSetCookie().some((c) => c.startsWith("chef_session=usr_new.org_new."))).toBe(true);
  });

  it("moves a chef set up before organizations into the person's default organization", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (String(input instanceof Request ? input.url : input).endsWith("/user") ? Response.json({ result: { id: "cfuser", email: "sam@example.com" } }) : Response.json({ access_token: "tok", expires_in: 600, result: [] }))));
    const legacy = { url: "https://chef.sam.workers.dev", secret: "old", accountId: "a1", version: "v1" };
    const { env, fake } = fakeEnv({ legacy: { cfuser: legacy } });
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier" } }), env);
    expect(response.headers.get("location")).toBe("/");
    expect(fake.orgs["org_new"]?.engine).toEqual(legacy);
    expect(fake.calls).toContainEqual({ name: "directory", method: "recordSetup", arg: { orgId: "org_new", setup: { accountId: "a1", engine: legacy.url, version: "v1", install: "done", error: null } } });
  });

  it("starts setup only for a same-site request from an owner or admin of the organization", async () => {
    const { env, fake } = fakeEnv();
    const body = JSON.stringify({ accountId: "0123456789abcdef0123456789abcdef" });
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin: "https://evil.example", cookie: await session() } }), env)).status).toBe(403);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin } }), env)).status).toBe(401);
    const forged = `chef_session=${await signSession("not-ours", { userId: "user1", orgId: "org1" }, Date.now())}`;
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: forged } }), env)).status).toBe(401);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session("user1", "someone-elses") } }), env)).status).toBe(401);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session() } }), env)).status).toBe(202);
    expect(fake.calls).toEqual([{ name: "user1", method: "install", arg: { orgId: "org1", orgName: "sam's org", accountId: "0123456789abcdef0123456789abcdef", engine: null } }]);
    const plain = fakeEnv({ role: "member" });
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session() } }), plain.env)).status).toBe(403);
  });

  it("sends chef's API to the organization's engine and tells the app who is signed in where", async () => {
    const fetchMock = vi.fn(async () => Response.json({ projects: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = fakeEnv({ engine: ENGINE });
    expect((await handle(new Request(`${origin}/api/projects`), fakeEnv().env)).status).toBe(401);
    expect((await handle(new Request(`${origin}/api/projects`, { headers: { cookie: await session() } }), fakeEnv().env)).status).toBe(401);
    const response = await handle(new Request(`${origin}/api/projects`, { headers: { cookie: await session() } }), env);
    expect(await response.json()).toEqual({ projects: [] });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("https://chef.sam.workers.dev/api/projects");
    const mode = await handle(new Request(`${origin}/api/app`, { headers: { cookie: await session() } }), env);
    expect(await mode.json()).toEqual({
      mode: "cloud",
      place: "cloud",
      engine: origin,
      fixed: true,
      account: "sam@example.com",
      org: { id: "org1", name: "sam's org", role: "owner", engine: ENGINE.url, members: 2 },
      orgs: [{ id: "org1", name: "sam's org", role: "owner" }],
    });
  });

  it("creates, switches to and renames organizations", async () => {
    const { env, fake } = fakeEnv();
    const created = await handle(send("/site/api/orgs", "POST", { name: "  Acme   Labs " }, await session()), env);
    expect(await created.json()).toEqual({ org: { id: "org2", name: "Acme Labs", role: "owner" } });
    expect(created.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org2\./);
    expect(fake.orgs["org2"]?.members).toEqual({ user1: "owner" });
    expect((await handle(send("/site/api/orgs", "POST", { name: "" }, await session()), env)).status).toBe(400);
    const back = await handle(send("/site/api/orgs/switch", "POST", { orgId: "org_abcdefghijklmnopqrst" }, await session()), env);
    expect(back.status).toBe(404);
    fake.orgs["org_abcdefghijklmnopqrst"] = { name: "Team", engine: null, members: { user1: "member" } };
    const switched = await handle(send("/site/api/orgs/switch", "POST", { orgId: "org_abcdefghijklmnopqrst" }, await session()), env);
    expect(switched.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org_abcdefghijklmnopqrst\./);
    expect((await handle(send("/site/api/org", "PATCH", { name: "Nope" }, await session("user1", "org_abcdefghijklmnopqrst")), env)).status).toBe(403);
    const renamed = await handle(send("/site/api/org", "PATCH", { name: "Sam and co" }, await session()), env);
    expect(((await renamed.json()) as { org: { name: string } }).org.name).toBe("Sam and co");
    expect(fake.calls).toContainEqual({ name: "directory", method: "renameOrg", arg: { orgId: "org1", name: "Sam and co" } });
  });

  it("signs out only from its own pages", async () => {
    expect((await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin: "https://evil.example" } }), fakeEnv().env)).status).toBe(405);
    const response = await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin } }), fakeEnv().env);
    expect(response.headers.get("set-cookie")).toContain("chef_session=; Path=/; Max-Age=0");
  });

  it("shows members only to PlaygrndLabs admins", async () => {
    const admin = fakeEnv({ admins: ["boss"] }).env;
    expect((await handle(new Request(`${origin}/admin`, { headers: { cookie: await session() } }), admin)).headers.get("location")).toBe("/");
    expect((await handle(new Request(`${origin}/admin`), admin)).headers.get("location")).toBe("/");
    expect(await (await handle(new Request(`${origin}/admin`, { headers: { cookie: await session("boss") } }), admin)).text()).toBe("asset /admin");
    expect((await handle(new Request(`${origin}/site/api/admin/members`, { headers: { cookie: await session() } }), admin)).status).toBe(403);
    const list = await handle(new Request(`${origin}/site/api/admin/members`, { headers: { cookie: await session("boss") } }), admin);
    expect(await list.json()).toEqual({ latest: "v2", users: [{ id: "user1", email: "sam@example.com" }], orgs: [] });
  });
});
