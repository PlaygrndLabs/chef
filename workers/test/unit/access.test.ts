import { describe, expect, it } from "vitest";
import { newToken } from "@chef/core/access";
import { deploymentPassword, EXAMPLE_PASSWORD, guard, hashPassword, homeOrigin, trusted, type Access, type Caller, type Credential, type StoredPassword } from "../../src/access.ts";
import { mintGrant, type Grant } from "../../src/grants.ts";

const at = (path: string, init?: RequestInit) => new Request(`https://chef.example${path}`, init);
const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

function access(options: { credential?: Credential | null; deploymentKey?: string | null; sealed?: boolean; grants?: readonly Grant[]; claim?: (password: StoredPassword) => Promise<boolean>; home?: string | null; now?: number } = {}): Access & { readonly usedIds: string[] } {
  const usedIds: string[] = [];
  return {
    password: async () => options.credential ?? null,
    deploymentKey: options.deploymentKey ?? null,
    sealed: async () => options.sealed ?? false,
    grant: async (id) => options.grants?.find((grant) => grant.id === id) ?? null,
    claim: options.claim ?? (async () => false),
    used: (grant) => void usedIds.push(grant.id),
    home: options.home ?? null,
    now: () => options.now ?? Date.now(),
    usedIds,
  };
}

const response = (result: Response | Caller): Response => {
  expect(result).toBeInstanceOf(Response);
  return result as Response;
};

async function signsInWith(credential: Credential, password: string) {
  const gate = access({ credential });
  expect(response(await guard(at("/"), gate)).headers.get("content-type")).toContain("text/html");
  expect(response(await guard(at("/api/projects/demo/sessions"), gate)).status).toBe(401);
  expect(response(await guard(at("/login", form({ password: "nope-nope" })), gate)).status).toBe(401);
  const login = response(await guard(at("/login", form({ password })), gate));
  expect(login.status).toBe(303);
  const session = (login.headers.get("set-cookie") ?? "").split(";")[0] as string;
  expect(await guard(at("/api/projects/demo/sessions", { headers: { cookie: session } }), gate)).toEqual({ kind: "browser" });
  expect(response(await guard(at("/", { headers: { cookie: "chef_access=forged" } }), gate)).status).toBe(200);
}

describe("dashboard access", () => {
  it("ignores an empty or example CHEF_PASSWORD so a one-click deploy never ships a known password", () => {
    expect(deploymentPassword({})).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: "  " })).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: EXAMPLE_PASSWORD })).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: "a real password" })).toBe("a real password");
  });

  it("asks the first visitor to set a password and refuses the API until then", async () => {
    let stored: StoredPassword | null = null;
    const gate = access({
      claim: async (password) => {
        if (stored) return false;
        stored = password;
        return true;
      },
    });
    expect(response(await guard(at("/api/projects/demo/sessions"), gate)).status).toBe(503);
    expect(await response(await guard(at("/"), gate)).text()).toContain("Set the password");
    expect(response(await guard(at("/setup", form({ password: "short", confirm: "short" })), gate)).status).toBe(400);
    expect(response(await guard(at("/setup", form({ password: "long enough", confirm: "different" })), gate)).status).toBe(400);
    const done = response(await guard(at("/setup", form({ password: "long enough", confirm: "long enough" })), gate));
    expect(done.status).toBe(303);
    expect(done.headers.get("set-cookie")).toContain("chef_access=");
    expect(stored).not.toBeNull();
    const late = response(await guard(at("/setup", form({ password: "someone else", confirm: "someone else" })), gate));
    expect(late.headers.get("set-cookie")).toBeNull();
  });

  it("signs in with the deployment's password", async () => {
    await signsInWith({ kind: "deployment", password: "s3cret-pass" }, "s3cret-pass");
  });

  it("signs in with a password set in the app", async () => {
    await signsInWith({ kind: "app", ...(await hashPassword("app password")) }, "app password");
  });

  it("never takes a password as a Bearer token, and says what scripts should send instead", async () => {
    const gate = access({ credential: { kind: "deployment", password: "s3cret-pass" } });
    const refused = response(await guard(at("/api/projects", bearer("s3cret-pass")), gate));
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { error: string }).error).toContain("API key");
  });

  it("reads the home address, ignoring anything that is not a web address", () => {
    expect(homeOrigin({})).toBeNull();
    expect(homeOrigin({ CHEF_HOME: "not a url" })).toBeNull();
    expect(homeOrigin({ CHEF_HOME: "javascript:alert(1)" })).toBeNull();
    expect(homeOrigin({ CHEF_HOME: " https://chef.example/ " })).toBe("https://chef.example");
  });
});

describe("API keys", () => {
  it("lets the deployment's key in as an app that manages chef, on every path", async () => {
    const { token } = newToken();
    const gate = access({ deploymentKey: token });
    for (const path of ["/api/projects", "/preview/demo/abc", "/agents/project/demo", "/"]) {
      const caller = await guard(at(path, bearer(token)), gate);
      expect(caller).toMatchObject({ kind: "grant", grant: { kind: "controller", name: "Set at install", scopes: ["*"] } });
    }
    expect(gate.usedIds.length).toBe(4);
  });

  it("lets a stored key in until it runs out, and refuses a wrong or revoked one", async () => {
    const { grant, token } = await mintGrant({ name: "deploy script", kind: "key", expiresAt: 2_000 }, 1_000);
    expect(await guard(at("/api/projects", bearer(token)), access({ grants: [grant], now: 1_500 }))).toMatchObject({ kind: "grant", grant: { id: grant.id, kind: "key" } });
    expect(response(await guard(at("/api/projects", bearer(token)), access({ grants: [grant], now: 2_500 }))).status).toBe(401);
    expect(response(await guard(at("/api/projects", bearer(token)), access({ grants: [] }))).status).toBe(401);
    const forged = `${token.slice(0, -4)}AAAA`;
    expect(response(await guard(at("/api/projects", bearer(forged)), access({ grants: [grant] }))).status).toBe(401);
  });

  it("keeps a key-only chef closed to browsers: no sign-in page, no setup for the first visitor", async () => {
    const { token } = newToken();
    const home = "https://dashboard.example";
    const withHome = access({ deploymentKey: token, home });
    const sent = response(await guard(at("/project/demo"), withHome));
    expect(sent.status).toBe(302);
    expect(sent.headers.get("location")).toBe(home);
    expect(response(await guard(at("/setup", form({ password: "long enough", confirm: "long enough" })), withHome)).status).toBe(302);
    const api = response(await guard(at("/api/projects"), withHome));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: `open chef at ${home}` });
    const sealed = access({ sealed: true });
    expect(response(await guard(at("/"), sealed)).status).toBe(403);
    expect(response(await guard(at("/setup", form({ password: "long enough", confirm: "long enough" })), sealed)).status).toBe(403);
  });

  it("passes on who a request is for only when it comes from an app that manages chef", async () => {
    const { grant } = await mintGrant({ name: "script", kind: "key", expiresAt: null }, 1);
    const sent = at("/api/projects", { headers: { "x-chef-user": "usr_abcdefghijklmnopqrst", "x-chef-origin": "https://dashboard.example" } });
    const controller: Caller = { kind: "grant", grant: { ...grant, kind: "controller" } };
    expect(trusted(sent, controller).headers.get("x-chef-user")).toBe("usr_abcdefghijklmnopqrst");
    for (const caller of [{ kind: "browser" } as const, { kind: "grant", grant } as const, null]) {
      const kept = trusted(sent, caller);
      expect(kept.headers.get("x-chef-user")).toBeNull();
      expect(kept.headers.get("x-chef-origin")).toBeNull();
    }
  });
});
