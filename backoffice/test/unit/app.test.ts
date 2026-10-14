import { describe, expect, it } from "vitest";
import { handle } from "../../src/app.ts";
import type { Env } from "../../src/env.ts";
import { COOKIE, readSession, signSession } from "../../src/session.ts";

const origin = "https://chef-backoffice.example.workers.dev";
const BOSS = "usr_bossbossbossbossboss";
const ORG = "org_acmeacmeacmeacmeacme";
const KIM = "usr_kimkimkimkimkimkimki";
const SECRET = "backoffice-secret";

function fakeEnv() {
  const calls: { method: string; args: unknown[] }[] = [];
  const admins = new Set([BOSS]);
  const guard = (method: string) => async (adminId: string, ...args: unknown[]) => {
    calls.push({ method, args: [adminId, ...args] });
    return admins.has(adminId) ? { method, args } : { error: "only PlaygrndLabs admins can use the backoffice", status: 403 };
  };
  const site = {
    redeem: async (ticket: string) => (ticket === `${BOSS}.good-ticket` ? { userId: BOSS, email: "boss@playgrndlabs.com" } : null),
    me: guard("me"),
    directory: guard("directory"),
    org: guard("org"),
    person: guard("person"),
    renameOrg: guard("renameOrg"),
    setRole: guard("setRole"),
    removeMember: guard("removeMember"),
    cancelInvite: guard("cancelInvite"),
    setBudget: guard("setBudget"),
  };
  const env = {
    ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`, { headers: { "content-type": "text/html" } }) },
    SITE: site,
    SITE_URL: "https://chef.example.com",
    SESSION_SECRET: SECRET,
  } as unknown as Env;
  return { env, calls, admins };
}

const signedIn = async (userId = BOSS) => `${COOKIE}=${await signSession(SECRET, userId, Date.now())}`;
const send = async (path: string, method: string, body?: unknown, cookie?: string, from: string | null = origin) =>
  new Request(`${origin}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(from ? { origin: from } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

describe("backoffice", () => {
  it("sends people without a session to chef to sign in", async () => {
    const { env } = fakeEnv();
    expect((await handle(new Request(`${origin}/`), env)).headers.get("location")).toBe("/auth/start");
    expect((await handle(new Request(`${origin}/app.js`), env)).headers.get("location")).toBe("/auth/start");
    expect(await (await handle(new Request(`${origin}/style.css`), env)).text()).toBe("asset /style.css");
    expect((await handle(new Request(`${origin}/auth/start`), env)).headers.get("location")).toBe("https://chef.example.com/backoffice");
    expect((await handle(new Request(`${origin}/api/directory`), env)).status).toBe(401);
    const forged = `${COOKIE}=${await signSession("another-secret", BOSS, Date.now())}`;
    expect((await handle(new Request(`${origin}/api/directory`, { headers: { cookie: forged } }), env)).status).toBe(401);
  });

  it("signs in an admin with a ticket from chef, and refuses anyone else", async () => {
    const { env } = fakeEnv();
    const refused = await handle(new Request(`${origin}/auth/callback?ticket=${BOSS}.bad`), env);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(await refused.text()).toContain("Only PlaygrndLabs admins");
    const ok = await handle(new Request(`${origin}/auth/callback?ticket=${BOSS}.good-ticket`), env);
    expect(ok.headers.get("location")).toBe("/");
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${COOKIE}=${BOSS}\\.\\d+\\.[A-Za-z0-9_-]{43}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax$`));
    expect(await readSession(SECRET, cookie.split(";")[0]?.split("=")[1], Date.now())).toBe(BOSS);
    expect(await readSession(SECRET, cookie.split(";")[0]?.split("=")[1], Date.now() + 13 * 3600 * 1000)).toBeNull();
    const page = await handle(new Request(`${origin}/`, { headers: { cookie: await signedIn() } }), env);
    expect(await page.text()).toBe("asset /");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  it("passes every call to chef as the signed-in admin, and lets chef refuse", async () => {
    const { env, calls, admins } = fakeEnv();
    const cookie = await signedIn();
    expect(await (await handle(new Request(`${origin}/api/directory`, { headers: { cookie } }), env)).json()).toEqual({ method: "directory", args: [] });
    await handle(new Request(`${origin}/api/orgs/${ORG}`, { headers: { cookie } }), env);
    await handle(new Request(`${origin}/api/people/${KIM}`, { headers: { cookie } }), env);
    await handle(await send(`/api/orgs/${ORG}`, "PATCH", { name: "Acme Labs" }, cookie), env);
    await handle(await send(`/api/orgs/${ORG}/budget`, "PUT", { dollars: 75 }, cookie), env);
    await handle(await send(`/api/orgs/${ORG}/budget`, "PUT", {}, cookie), env);
    await handle(await send(`/api/orgs/${ORG}/members/${KIM}`, "PATCH", { role: "admin" }, cookie), env);
    await handle(await send(`/api/orgs/${ORG}/members/${KIM}`, "DELETE", undefined, cookie), env);
    await handle(await send(`/api/orgs/${ORG}/invites/${encodeURIComponent("lee@example.com")}`, "DELETE", undefined, cookie), env);
    expect(calls).toEqual([
      { method: "directory", args: [BOSS] },
      { method: "org", args: [BOSS, ORG] },
      { method: "person", args: [BOSS, KIM] },
      { method: "renameOrg", args: [BOSS, ORG, "Acme Labs"] },
      { method: "setBudget", args: [BOSS, ORG, 75] },
      { method: "setBudget", args: [BOSS, ORG, null] },
      { method: "setRole", args: [BOSS, ORG, KIM, "admin"] },
      { method: "removeMember", args: [BOSS, ORG, KIM] },
      { method: "cancelInvite", args: [BOSS, ORG, "lee@example.com"] },
    ]);
    expect((await handle(new Request(`${origin}/api/orgs/org_bad`, { headers: { cookie } }), env)).status).toBe(404);
    admins.clear();
    const refused = await handle(new Request(`${origin}/api/directory`, { headers: { cookie } }), env);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "only PlaygrndLabs admins can use the backoffice" });
  });

  it("refuses changes sent from other sites", async () => {
    const { env, calls } = fakeEnv();
    const cookie = await signedIn();
    expect((await handle(await send(`/api/orgs/${ORG}`, "PATCH", { name: "x" }, cookie, "https://evil.example"), env)).status).toBe(403);
    expect((await handle(await send(`/api/orgs/${ORG}`, "PATCH", { name: "x" }, cookie, null), env)).status).toBe(403);
    expect((await handle(await send("/auth/signout", "POST", undefined, cookie, "https://evil.example"), env)).status).toBe(405);
    expect(calls).toEqual([]);
    const out = await handle(await send("/auth/signout", "POST", undefined, cookie), env);
    expect(out.headers.get("set-cookie")).toContain(`${COOKIE}=; Path=/; Max-Age=0`);
  });

  it("answers when chef cannot be reached", async () => {
    const { env } = fakeEnv();
    (env.SITE as unknown as { directory: () => Promise<never> }).directory = async () => {
      throw new Error("down");
    };
    expect((await handle(new Request(`${origin}/api/directory`, { headers: { cookie: await signedIn() } }), env)).status).toBe(502);
  });
});
