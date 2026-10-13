import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";
import { signSession } from "../../src/oauth.ts";

interface Fake {
  engine: { url: string; secret: string } | null;
  calls: { name: string; method: string; arg?: unknown }[];
}

function fakeEnv(state: Partial<Fake> = {}, withClient = true) {
  const fake: Fake = { engine: null, calls: [], ...state };
  const stub = (name: string) => ({
    signIn: async (profile: unknown, grant: unknown) => void fake.calls.push({ name, method: "signIn", arg: { profile, grant } }),
    engine: async () => fake.engine,
    view: async () => ({ email: "sam@example.com", engine: fake.engine?.url ?? null, canSetUp: true, install: null }),
    accounts: async () => [{ id: "a1", name: "Mine", plan: "paid", hasChef: false, subdomain: "mine" }],
    status: async () => ({ status: "idle" }),
    install: async (arg: unknown) => (fake.calls.push({ name, method: "install", arg }), { status: "running" }),
    dismiss: async () => undefined,
  });
  const env = {
    ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) },
    MEMBER: { idFromName: (name: string) => name, get: (name: string) => stub(name) },
    ...(withClient ? { OAUTH_CLIENT_ID: "abc", OAUTH_CLIENT_SECRET: "shh", OAUTH_SCOPES: "s.read" } : {}),
  } as unknown as Env;
  return { env, fake };
}

const origin = "https://chef.example.com";
const session = async (user = "user1") => `chef_session=${await signSession("shh", user, Date.now())}`;

afterEach(() => vi.unstubAllGlobals());

describe("chef site", () => {
  it("shows the landing page to visitors, the app to members with an engine and setup to the rest", async () => {
    expect(await (await handle(new Request(`${origin}/`), fakeEnv().env)).text()).toBe("asset /");
    expect(await (await handle(new Request(`${origin}/`, { headers: { cookie: await session() } }), fakeEnv({ engine: { url: "https://chef.sam.workers.dev", secret: "s" } }).env)).text()).toBe("asset /app");
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

  it("signs the person in as their Cloudflare user and sends a new member to setup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input instanceof Request ? input.url : input).endsWith("/user") ? Response.json({ result: { id: "cfuser", email: "sam@example.com" } }) : Response.json({ access_token: "tok", expires_in: 600 })));
    vi.stubGlobal("fetch", fetchMock);
    const { env, fake } = fakeEnv();
    const response = await handle(new Request(`${origin}/auth/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier" } }), env);
    expect(response.headers.get("location")).toBe("/setup");
    expect(fake.calls).toMatchObject([{ name: "cfuser", method: "signIn", arg: { profile: { id: "cfuser", email: "sam@example.com" }, grant: { token: "tok" } } }]);
    expect(response.headers.getSetCookie().some((c) => c.startsWith("chef_session=cfuser."))).toBe(true);
  });

  it("starts setup only for a same-site request from a member", async () => {
    const { env, fake } = fakeEnv();
    const body = JSON.stringify({ accountId: "0123456789abcdef0123456789abcdef" });
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin: "https://evil.example", cookie: await session() } }), env)).status).toBe(403);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin } }), env)).status).toBe(401);
    const forged = `chef_session=${await signSession("not-ours", "user1", Date.now())}`;
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: forged } }), env)).status).toBe(401);
    expect((await handle(new Request(`${origin}/site/api/install`, { method: "POST", body, headers: { origin, cookie: await session() } }), env)).status).toBe(202);
    expect(fake.calls).toEqual([{ name: "user1", method: "install", arg: { accountId: "0123456789abcdef0123456789abcdef" } }]);
  });

  it("sends chef's API to the member's own engine and tells the app who is signed in", async () => {
    const fetchMock = vi.fn(async () => Response.json({ projects: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = fakeEnv({ engine: { url: "https://chef.sam.workers.dev", secret: "engine-secret" } });
    expect((await handle(new Request(`${origin}/api/projects`), fakeEnv().env)).status).toBe(401);
    const response = await handle(new Request(`${origin}/api/projects`, { headers: { cookie: await session() } }), env);
    expect(await response.json()).toEqual({ projects: [] });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("https://chef.sam.workers.dev/api/projects");
    const mode = await handle(new Request(`${origin}/api/app`, { headers: { cookie: await session() } }), env);
    expect(await mode.json()).toEqual({ mode: "cloud", place: "cloud", engine: origin, fixed: true, account: "sam@example.com" });
  });

  it("signs out only from its own pages", async () => {
    expect((await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin: "https://evil.example" } }), fakeEnv().env)).status).toBe(405);
    const response = await handle(new Request(`${origin}/auth/signout`, { method: "POST", headers: { origin } }), fakeEnv().env);
    expect(response.headers.get("set-cookie")).toContain("chef_session=; Path=/; Max-Age=0");
  });
});
