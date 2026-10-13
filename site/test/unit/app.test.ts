import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";

function fakeEnv(withClient = true) {
  const calls: { name: string; method: string; arg?: unknown }[] = [];
  const stub = (name: string) => ({
    begin: async (arg: unknown) => void calls.push({ name, method: "begin", arg }),
    status: async () => ({ status: "idle" }),
    signedIn: async () => true,
    accounts: async () => [{ id: "a1", name: "Mine", plan: "paid", chefUrl: null, subdomain: "mine" }],
    install: async (arg: unknown) => (calls.push({ name, method: "install", arg }), { status: "running" }),
    end: async () => void calls.push({ name, method: "end" }),
  });
  const env = {
    ASSETS: { fetch: async () => new Response("page") },
    SETUP: { idFromName: (name: string) => name, get: (name: string) => stub(name) },
    ...(withClient ? { OAUTH_CLIENT_ID: "abc", OAUTH_CLIENT_SECRET: "shh", OAUTH_SCOPES: "s.read" } : {}),
  } as unknown as Env;
  return { env, calls };
}

const origin = "https://getchef.example";
const sid = "s".repeat(43);

afterEach(() => vi.unstubAllGlobals());

describe("landing site", () => {
  it("serves the pages from static assets", async () => {
    const response = await handle(new Request(`${origin}/`), fakeEnv().env);
    expect(await response.text()).toBe("page");
  });

  it("explains when sign-in is not configured yet", async () => {
    const response = await handle(new Request(`${origin}/start`), fakeEnv(false).env);
    expect(response.headers.get("location")).toBe("/?signin=unavailable#get-started");
  });

  it("starts sign-in at Cloudflare and remembers the state for the callback only", async () => {
    const response = await handle(new Request(`${origin}/start`), fakeEnv().env);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.host).toBe("dash.cloudflare.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/callback`);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^chef_oauth=${location.searchParams.get("state")}\\.[\\w-]+; Path=/callback;`));
  });

  it("refuses a callback whose state does not match", async () => {
    const response = await handle(new Request(`${origin}/callback?code=c&state=other`, { headers: { cookie: "chef_oauth=mine.verifier" } }), fakeEnv().env);
    expect(response.headers.get("location")).toBe("/?signin=cancelled#get-started");
  });

  it("trades the code for a token, keeps it in a fresh setup session and opens the setup page", async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: "tok", expires_in: 600 }));
    vi.stubGlobal("fetch", fetchMock);
    const { env, calls } = fakeEnv();
    const response = await handle(new Request(`${origin}/callback?code=c&state=mine`, { headers: { cookie: "chef_oauth=mine.verifier" } }), env);
    expect(response.headers.get("location")).toBe("/setup");
    const request = (fetchMock.mock.calls[0] as unknown as [Request])[0];
    expect(await request.text()).toContain("code_verifier=verifier");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "begin", arg: { token: "tok" } });
    expect(response.headers.get("set-cookie")).toContain(`chef_setup=${calls[0]?.name}; Path=/; Max-Age=3600; HttpOnly; Secure`);
  });

  it("starts setup only for a same-site request with a session", async () => {
    const { env, calls } = fakeEnv();
    const body = JSON.stringify({ accountId: "0123456789abcdef0123456789abcdef", password: "a long password" });
    expect((await handle(new Request(`${origin}/api/install`, { method: "POST", body, headers: { origin: "https://evil.example", cookie: `chef_setup=${sid}` } }), env)).status).toBe(403);
    expect((await handle(new Request(`${origin}/api/install`, { method: "POST", body, headers: { origin } }), env)).status).toBe(401);
    const started = await handle(new Request(`${origin}/api/install`, { method: "POST", body, headers: { origin, cookie: `chef_setup=${sid}` } }), env);
    expect(started.status).toBe(202);
    expect(calls).toEqual([{ name: sid, method: "install", arg: { accountId: "0123456789abcdef0123456789abcdef", password: "a long password", name: "chef" } }]);
  });

  it("lists the visitor's accounts once signed in", async () => {
    const signedOut = await handle(new Request(`${origin}/api/session`), fakeEnv().env);
    expect(await signedOut.json()).toEqual({ signedIn: false, accounts: [], install: null });
    const signedIn = await handle(new Request(`${origin}/api/session`, { headers: { cookie: `chef_setup=${sid}` } }), fakeEnv().env);
    expect(await signedIn.json()).toMatchObject({ signedIn: true, accounts: [{ id: "a1", plan: "paid" }], install: null });
  });
});
