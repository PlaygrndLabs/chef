import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";
import { signSession } from "../../src/oauth.ts";
import type { ProjectLevel, Role } from "../../src/orgs.ts";

interface OrgState {
  name: string;
  personal?: boolean;
  engine: { url: string; secret: string; accountId?: string; version?: string } | null;
  members: Record<string, Role>;
  projects?: Record<string, Record<string, ProjectLevel>>;
  updating?: boolean;
}

interface Fake {
  orgs: Record<string, OrgState>;
  admins: string[];
  later?: boolean;
  stale?: boolean;
  calls: { name: string; method: string; arg?: unknown }[];
}

const ENGINE = { url: "https://chef.sam.workers.dev", secret: "engine-secret" };

function fakeEnv(state: Partial<Fake> & { engine?: OrgState["engine"]; role?: Role } = {}, withClient = true) {
  const fake: Fake = { orgs: { org1: { name: "Personal", personal: true, engine: state.engine ?? null, members: { user1: state.role ?? "owner", boss: "owner" } } }, admins: [], calls: [], ...state };
  const summaries = (userId: string) => Object.entries(fake.orgs).flatMap(([id, org]) => (org.members[userId] ? [{ id, name: org.name, role: org.members[userId], personal: org.personal === true, plan: "free" }] : []));
  const level = (id: string, userId: string, project: string): ProjectLevel | null => {
    const state = fake.orgs[id];
    const role = state?.members[userId];
    if (role === "owner" || role === "admin") return "manage";
    return state?.projects?.[project]?.[userId] ?? null;
  };
  const member = (name: string) => ({
    signIn: async (profile: unknown, grant: unknown, admin: unknown, org: unknown, removing?: boolean) => void fake.calls.push({ name, method: "signIn", arg: { profile, grant, admin, org, ...(removing ? { removing } : {}) } }),
    admin: async () => fake.admins.includes(name),
    backofficeTicket: async () => (fake.calls.push({ name, method: "backofficeTicket" }), `ticket-${fake.calls.filter((c) => c.method === "backofficeTicket").length}`),
    view: async () => ({ email: "sam@example.com", admin: fake.admins.includes(name), canSetUp: true, install: null }),
    accounts: async () => [{ id: "a1", name: "Mine", plan: "paid", subdomain: "mine" }],
    status: async () => ({ status: "idle" }),
    install: async (arg: unknown) => (fake.calls.push({ name, method: "install", arg }), { status: "running" }),
    dismiss: async () => undefined,
    removal: async () => null,
    remove: async (arg: unknown) => (fake.calls.push({ name, method: "remove", arg }), { status: "running" }),
    dismissRemoval: async () => undefined,
    later: async () => void (fake.later = true),
    askedLater: async () => {
      if (fake.stale) throw new Error('The RPC receiver does not implement the method "askedLater".');
      return fake.later === true;
    },
  });
  const org = (id: string) => ({
    setup: async (info: { name: string }, who: { userId: string; role: Role }) => {
      fake.calls.push({ name: id, method: "setup", arg: { info, who } });
      fake.orgs[id] ??= { name: info.name, engine: null, members: {} };
      fake.orgs[id].members[who.userId] = who.role;
    },
    access: async (userId: string, project: string | null = null) => (fake.orgs[id]?.members[userId] ? { role: fake.orgs[id].members[userId], engine: fake.orgs[id].engine, level: project ? level(id, userId, project) : null, updating: fake.orgs[id].updating === true } : null),
    levels: async (userId: string, names: string[]) => Object.fromEntries(names.flatMap((n) => (level(id, userId, n) ? [[n, level(id, userId, n)]] : []))),
    claimProject: async (userId: string, name: string) => {
      const state = fake.orgs[id] as OrgState;
      if (state.projects?.[name] && level(id, userId, name) !== "manage") return false;
      state.projects = { ...state.projects, [name]: { [userId]: "manage" } };
      return true;
    },
    view: async (userId: string) => (fake.orgs[id]?.members[userId] ? { id, name: fake.orgs[id].name, role: fake.orgs[id].members[userId], personal: fake.orgs[id].personal === true, plan: "free", engine: fake.orgs[id].engine?.url ?? null, members: Object.keys(fake.orgs[id].members).length } : null),
    members: async () => Object.entries(fake.orgs[id]?.members ?? {}).map(([userId, role]) => ({ userId, role })),
    rename: async (name: string) => void ((fake.orgs[id] as OrgState).name = name),
    engine: async () => fake.orgs[id]?.engine ?? null,
    setEngine: async (engine: OrgState["engine"]) => void ((fake.orgs[id] as OrgState).engine = engine),
    removing: async () => false,
    updating: async () => fake.orgs[id]?.updating === true,
  });
  const dir = {
    signIn: async (identity: { subject: string; email: string }, admin: boolean) => {
      fake.calls.push({ name: "directory", method: "signIn", arg: { identity, admin } });
      return { userId: "usr_new", org: { id: "org_new", name: "Personal", role: "owner", personal: true, plan: "free" }, orgs: [{ id: "org_new", name: "Personal", role: "owner", personal: true, plan: "free" }], joined: [] };
    },
    orgs: async (userId: string) => summaries(userId),
    home: async (userId: string) => summaries(userId).find((o) => o.personal) ?? null,
    createOrg: async (userId: string, name: string) => (fake.calls.push({ name: "directory", method: "createOrg", arg: { userId, name } }), { id: "org2", name, role: "owner", personal: false, plan: "free" }),
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
    expect(response.headers.get("location")).toBe("/?signin=unavailable");
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
    expect(response.headers.get("location")).toBe("/?signin=expired");
  });

  it("says the sign-in timed out when the pending cookie is gone", async () => {
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`), fakeEnv().env);
    expect(response.headers.get("location")).toBe("/?signin=expired");
  });

  it("says the sign-in was cancelled when Cloudflare returns an error", async () => {
    const response = await handle(new Request(`${origin}/auth/callback?error=access_denied&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier" } }), fakeEnv().env);
    expect(response.headers.get("location")).toBe("/?signin=cancelled");
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
      { name: "org_new", method: "setup", arg: { info: { id: "org_new", name: "Personal", personal: true }, who: { userId: "usr_new", role: "owner" } } },
      { name: "usr_new", method: "signIn", arg: { profile: { id: "cfuser" }, grant: { token: "tok" }, admin: false, org: { id: "org_new", canSetUp: true, engine: null } } },
    ]);
    expect(fake.orgs["org_new"]?.members).toEqual({ usr_new: "owner" });
    expect(response.headers.getSetCookie().some((c) => c.startsWith("chef_session=usr_new.org_new."))).toBe(true);
  });

  it("starts setup only for a same-site request from an owner or admin of the organization", async () => {
    const { env, fake } = fakeEnv();
    const body = JSON.stringify({ accountId: "0123456789abcdef0123456789abcdef" });
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin: "https://evil.example", cookie: await session() } }), env)).status).toBe(403);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin } }), env)).status).toBe(401);
    const forged = `chef_session=${await signSession("not-ours", { userId: "user1", orgId: "org1" }, Date.now())}`;
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: forged } }), env)).status).toBe(401);
    const gone = await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session("user1", "someone-elses") } }), env);
    expect(gone.status).toBe(409);
    expect(gone.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org1\./);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session() } }), env)).status).toBe(202);
    expect(fake.calls).toEqual([{ name: "user1", method: "install", arg: { orgId: "org1", orgName: "sam", accountId: "0123456789abcdef0123456789abcdef", engine: null } }]);
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
      engine: origin,
      account: "sam@example.com",
      org: { id: "org1", name: "Personal", role: "owner", personal: true, plan: "free", engine: ENGINE.url, members: 2 },
      orgs: [{ id: "org1", name: "Personal", role: "owner", personal: true, plan: "free" }],
      update: null,
    });
  });

  it("asks owners to update chef after sign-in, starts it on their word and locks only chef while it runs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ projects: [] })));
    const { env, fake } = fakeEnv({ engine: { ...ENGINE, accountId: "a1", version: "v1" } });
    (env as { ENGINE_VERSION?: string }).ENGINE_VERSION = "v2";
    const cookie = await session();
    const mode = async (who = cookie) => ((await (await handle(new Request(`${origin}/api/app`, { headers: { cookie: who } }), env)).json()) as { update: unknown }).update;
    expect(await mode()).toEqual({ running: false, canUpdate: true, ask: true });
    expect((await handle(send("/site/api/update/later", "POST", {}, cookie), env)).status).toBe(200);
    expect(await mode()).toEqual({ running: false, canUpdate: true, ask: false });
    const started = await handle(send("/site/api/update", "POST", {}, cookie), env);
    expect(started.status).toBe(202);
    expect(fake.calls.find((c) => c.method === "install")?.arg).toMatchObject({ orgId: "org1", accountId: "a1", engine: { version: "v1" } });
    (fake.orgs["org1"] as OrgState).updating = true;
    expect(await mode()).toEqual({ running: true, canUpdate: true, ask: false });
    const locked = await handle(new Request(`${origin}/api/projects`, { headers: { cookie } }), env);
    expect(locked.status).toBe(423);
    expect((await handle(new Request(`${origin}/site/api/orgs`, { headers: { cookie } }), env)).status).toBe(200);
    (fake.orgs["org1"] as OrgState).members["kim"] = "member";
    expect((await handle(send("/site/api/update", "POST", {}, await session("kim")), env)).status).toBe(403);
  });

  it("still tells the app who is signed in while a deploy leaves an older object answering", async () => {
    const { env, fake } = fakeEnv({ engine: ENGINE });
    fake.stale = true;
    const mode = await handle(new Request(`${origin}/api/app`, { headers: { cookie: await session() } }), env);
    expect(mode.status).toBe(200);
    expect(await mode.json()).toMatchObject({ account: "sam@example.com", org: { id: "org1" } });
  });

  it("shows each person only the projects they may open and holds them to their level", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return String(input).endsWith("/api/projects") ? Response.json({ projects: [{ name: "shop" }, { name: "blog" }, { name: "secret" }] }) : Response.json({ ok: true });
    }));
    const { env, fake } = fakeEnv({ engine: ENGINE, role: "member" });
    (fake.orgs["org1"] as OrgState).projects = { shop: { user1: "edit" }, blog: { user1: "view" }, secret: { boss: "manage" } };
    const cookie = await session();
    const listed = await handle(new Request(`${origin}/api/projects`, { headers: { cookie } }), env);
    expect(await listed.json()).toEqual({ projects: [{ name: "shop", access: "edit" }, { name: "blog", access: "view" }] });
    const boss = await handle(new Request(`${origin}/api/projects`, { headers: { cookie: await session("boss") } }), env);
    expect(((await boss.json()) as { projects: unknown[] }).projects).toHaveLength(3);
    expect((await handle(new Request(`${origin}/api/projects/secret/events`, { headers: { cookie } }), env)).status).toBe(404);
    expect((await handle(new Request(`${origin}/api/projects/blog/events`, { headers: { cookie } }), env)).status).toBe(200);
    expect((await handle(send("/api/projects/blog/prompts", "POST", { prompt: "hi" }, cookie), env)).status).toBe(403);
    expect((await handle(send("/api/projects/shop/prompts", "POST", { prompt: "hi" }, cookie), env)).status).toBe(200);
    expect((await handle(send("/api/projects/shop/settings", "PUT", {}, cookie), env)).status).toBe(403);
    expect((await handle(send("/api/settings", "PUT", {}, cookie), env)).status).toBe(403);
    expect((await handle(send("/api/settings", "PUT", {}, await session("boss")), env)).status).toBe(200);
    expect((await handle(send("/api/projects", "POST", { name: "secret" }, cookie), env)).status).toBe(409);
    expect((await handle(send("/api/projects", "POST", { name: "fresh" }, cookie), env)).status).toBe(200);
    expect(fake.orgs["org1"]?.projects?.["fresh"]).toEqual({ user1: "manage" });
    expect(calls.filter((c) => c.startsWith("POST") || c.startsWith("PUT"))).toEqual([
      `POST ${ENGINE.url}/api/projects/shop/prompts`,
      `PUT ${ENGINE.url}/api/settings`,
      `POST ${ENGINE.url}/api/projects`,
    ]);
  });

  it("creates, switches to and renames organizations", async () => {
    const { env, fake } = fakeEnv();
    const created = await handle(send("/site/api/orgs", "POST", { name: "  Acme   Labs " }, await session()), env);
    expect(await created.json()).toEqual({ org: { id: "org2", name: "Acme Labs", role: "owner", personal: false, plan: "free" } });
    expect(created.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org2\./);
    expect(fake.orgs["org2"]?.members).toEqual({ user1: "owner" });
    expect((await handle(send("/site/api/orgs", "POST", { name: "" }, await session()), env)).status).toBe(400);
    const back = await handle(send("/site/api/orgs/switch", "POST", { orgId: "org_abcdefghijklmnopqrst" }, await session()), env);
    expect(back.status).toBe(404);
    fake.orgs["org_abcdefghijklmnopqrst"] = { name: "Team", engine: null, members: { user1: "member" } };
    const switched = await handle(send("/site/api/orgs/switch", "POST", { orgId: "org_abcdefghijklmnopqrst" }, await session()), env);
    expect(switched.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org_abcdefghijklmnopqrst\./);
    expect((await handle(send("/site/api/org", "PATCH", { name: "Nope" }, await session("user1", "org_abcdefghijklmnopqrst")), env)).status).toBe(403);
    expect((await handle(send("/site/api/org", "PATCH", { name: "Sam and co" }, await session()), env)).status).toBe(400);
    const renamed = await handle(send("/site/api/org", "PATCH", { name: "Acme and co" }, await session("user1", "org2")), env);
    expect(((await renamed.json()) as { org: { name: string } }).org.name).toBe("Acme and co");
    expect(fake.calls).toContainEqual({ name: "directory", method: "renameOrg", arg: { orgId: "org2", name: "Acme and co" } });
  });

  it("signs out only from its own pages", async () => {
    expect((await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin: "https://evil.example" } }), fakeEnv().env)).status).toBe(405);
    const response = await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin } }), fakeEnv().env);
    expect(response.headers.get("set-cookie")).toContain("chef_session=; Path=/; Max-Age=0");
  });

  it("sends only PlaygrndLabs admins to the backoffice, with a one-time ticket", async () => {
    const { env: admin, fake } = fakeEnv({ admins: ["boss"] });
    const withBackoffice = { ...admin, BACKOFFICE_URL: "https://chef-backoffice.example.workers.dev" } as Env;
    expect((await handle(new Request(`${origin}/backoffice`, { headers: { cookie: await session() } }), withBackoffice)).headers.get("location")).toBe("/");
    expect((await handle(new Request(`${origin}/backoffice`), withBackoffice)).headers.get("location")).toBe("/auth/start?then=backoffice");
    expect((await handle(new Request(`${origin}/backoffice`, { headers: { cookie: await session("boss") } }), admin)).headers.get("location")).toBe("/");
    const sent = await handle(new Request(`${origin}/backoffice`, { headers: { cookie: await session("boss") } }), withBackoffice);
    expect(sent.headers.get("location")).toBe("https://chef-backoffice.example.workers.dev/auth/callback?ticket=boss.ticket-1");
    expect(fake.calls).toContainEqual({ name: "boss", method: "backofficeTicket" });
    expect((await handle(new Request(`${origin}/site/api/admin/members`, { headers: { cookie: await session("boss") } }), admin)).status).toBe(404);
  });

  it("lets only an owner delete an organization, after typing its name, and lists what goes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ projects: [{ name: "shop" }, { name: "blog" }] })));
    const engine = { ...ENGINE, name: "chef-acme-x7k2", accountId: "acc" };
    const { env, fake } = fakeEnv();
    fake.orgs["org2"] = { name: "Acme", engine, members: { user1: "owner", kim: "admin" } };
    const owner = await session("user1", "org2");
    const plan = await handle(new Request(`${origin}/site/api/remove`, { headers: { cookie: owner } }), env);
    expect(await plan.json()).toMatchObject({ allowed: true, signedIn: true, engine: { name: "chef-acme-x7k2", accountId: "acc", url: ENGINE.url }, projects: ["shop", "blog"], removal: null });
    const admin = await handle(new Request(`${origin}/site/api/remove`, { headers: { cookie: await session("kim", "org2") } }), env);
    expect(await admin.json()).toMatchObject({ allowed: false, engine: null, projects: null });
    expect((await handle(send("/site/api/remove", "POST", { confirm: "Acme" }, await session("kim", "org2")), env)).status).toBe(403);
    expect((await handle(send("/site/api/remove", "POST", { confirm: "acme" }, owner), env)).status).toBe(400);
    expect((await handle(send("/site/api/remove", "POST", {}, owner), env)).status).toBe(400);
    expect((await handle(send("/site/api/remove", "POST", { confirm: "Acme" }, owner), env)).status).toBe(202);
    expect(fake.calls.filter((c) => c.method === "remove")).toEqual([{ name: "user1", method: "remove", arg: { orgId: "org2", orgName: "Acme", personal: false, engine, projects: ["shop", "blog"] } }]);
  });

  it("offers an uninstall for Personal only when chef is set up there", async () => {
    const { env, fake } = fakeEnv();
    expect((await handle(send("/site/api/remove", "POST", { confirm: "Personal" }, await session()), env)).status).toBe(400);
    (fake.orgs["org1"] as OrgState).engine = { ...ENGINE, accountId: "acc" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ projects: [] })));
    expect((await handle(send("/site/api/remove", "POST", { confirm: "Personal" }, await session()), env)).status).toBe(202);
    expect(fake.calls.find((c) => c.method === "remove")?.arg).toMatchObject({ orgId: "org1", personal: true, projects: [] });
  });

  it("takes people back to Personal once their organization is gone", async () => {
    const { env } = fakeEnv();
    const cookie = await session("user1", "org_gone");
    for (const path of ["/", "/remove", "/site/api/remove"]) {
      const response = await handle(new Request(`${origin}${path}`, { headers: { cookie } }), env);
      expect(response.headers.get("location")).toBe(path);
      expect(response.headers.get("set-cookie")).toMatch(/^chef_session=user1\.org1\./);
    }
    expect(await (await handle(new Request(`${origin}/remove`, { headers: { cookie: await session() } }), env)).text()).toBe("asset /remove");
  });

  it("signs people in with Cloudflare on the way to the backoffice, and sends only admins on", async () => {
    const start = await handle(new Request(`${origin}/auth/start?then=backoffice`), fakeEnv().env);
    expect(start.headers.get("set-cookie")).toMatch(/^chef_oauth=[\w-]+\.[\w-]+\.backoffice;/);
    const accounts = { list: [{ id: "site-account" }] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.endsWith("/user")) return Response.json({ result: { id: "cfuser", email: "boss@example.com" } });
      if (target.includes("/accounts")) return Response.json({ result: accounts.list });
      return Response.json({ access_token: "tok", expires_in: 600 });
    }));
    const admin = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier.backoffice" } }), fakeEnv().env);
    expect(admin.headers.get("location")).toBe("/backoffice");
    accounts.list = [];
    const other = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier.backoffice" } }), fakeEnv().env);
    expect(other.headers.get("location")).toBe("/setup");
  });

  it("keeps the Cloudflare sign-in an owner makes to remove chef until removal starts", async () => {
    const start = await handle(new Request(`${origin}/auth/start?then=remove`), fakeEnv().env);
    expect(start.headers.get("set-cookie")).toMatch(/^chef_oauth=[\w-]+\.[\w-]+\.remove;/);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.endsWith("/user")) return Response.json({ result: { id: "cfuser", email: "sam@example.com" } });
      if (target.includes("/accounts")) return Response.json({ result: [] });
      return Response.json({ access_token: "tok", expires_in: 600 });
    }));
    const { env, fake } = fakeEnv();
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier.remove" } }), env);
    expect(response.headers.get("location")).toBe("/remove");
    expect(fake.calls.find((c) => c.method === "signIn" && c.name === "usr_new")?.arg).toMatchObject({ removing: true });
  });
});
